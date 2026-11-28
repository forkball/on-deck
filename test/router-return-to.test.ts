import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { hashPassword } from '../app/actions/auth/password.ts'
import { pool } from '../app/data/db.ts'
import { post, sessionCookieFrom } from './support/router.ts'
import { deleteUsers, insertUser, skipWithoutDatabase, type TestUser } from './support/db.ts'

// Every form post that redirects "back" reads where to from its hidden
// `return_to` field, which arrives in the body and is untrusted. The rule is
// safeReturnPath in app/ui/backLink.ts and is unit-tested there; these prove each
// handler actually goes through it, rather than redirecting to the raw field —
// which every one of them below once did. The login form's cases are in
// router-auth.test.ts.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('return_to on form posts', { skip: skipWithoutDatabase }, () => {
  const PASSWORD = 'correct-horse-battery'
  const OFF_SITE = ['//evil.test/path', 'https://evil.test/path', '/\\evil.test/path', 'javascript:alert(1)']
  const SAME_ORIGIN = '/profile/watched?page=2'

  let me: TestUser
  let other: TestUser
  let cookie: string
  let itemId: number

  before(async () => {
    me = await insertUser('router-return-to', await hashPassword(PASSWORD))
    other = await insertUser('router-return-to-other')
    // Admin, so the rematch route answers rather than refusing with a 403.
    await pool.query('update users set is_admin = true where id = $1', [me.id])

    const stamp = Date.now()
    const { rows } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie', 'test', $1, 'Return-To Fixture', '{}'::jsonb, $2) returning id`,
      [`return-to-${stamp}-${Math.random().toString(36).slice(2, 8)}`, stamp],
    )
    itemId = rows[0]!.id

    const login = await post('/auth/login', { identifier: me.email, password: PASSWORD })
    cookie = sessionCookieFrom(login)!
    assert.ok(cookie, 'expected the login to start a session')
  })

  after(async () => {
    await deleteUsers([me.id, other.id])
    await pool.query('delete from media_items where id = $1', [itemId])
    await pool.end()
  })

  // Logs the fixture through the real route, and answers the interaction it
  // made, so the update and destroy cases each have one of their own to act on.
  async function loggedInteractionId(): Promise<number> {
    const response = await post(`/movies/${itemId}/log`, { status: 'consumed' }, cookie)
    assert.equal(response.status, 303)
    const { rows } = await pool.query<{ id: number }>(
      'select id from user_media_interactions where user_id = $1 and media_item_id = $2',
      [me.id, itemId],
    )
    return rows[0]!.id
  }

  // Each case: the path to post to and any fields besides return_to, built
  // fresh per request since destroy consumes its interaction. `fallback` is
  // where the handler lands when return_to is refused; for rematch the empty
  // link is what makes it bounce back with an error rather than reach a
  // catalog provider over the network.
  const cases: {
    name: string
    request: () => Promise<{ path: string; body: Record<string, string> }>
    fallback: () => string
    sameOrigin: string
  }[] = [
    {
      name: 'users.follow',
      request: async () => ({ path: `/users/${other.id}/follow`, body: {} }),
      fallback: () => '/users/search',
      sameOrigin: SAME_ORIGIN,
    },
    {
      name: 'users.unfollow',
      request: async () => ({ path: `/users/${other.id}/unfollow`, body: {} }),
      fallback: () => '/users/search',
      sameOrigin: SAME_ORIGIN,
    },
    {
      name: 'interactions.update',
      request: async () => ({
        path: `/interactions/${await loggedInteractionId()}`,
        body: { _method: 'PUT', status: 'consumed', rating: '', notes: '' },
      }),
      fallback: () => '/profile?saved=1',
      sameOrigin: SAME_ORIGIN,
    },
    {
      name: 'interactions.destroy',
      request: async () => ({
        path: `/interactions/${await loggedInteractionId()}`,
        body: { _method: 'DELETE' },
      }),
      fallback: () => '/profile?saved=1',
      sameOrigin: SAME_ORIGIN,
    },
    {
      name: 'movies.log',
      request: async () => ({ path: `/movies/${itemId}/log`, body: { status: 'want_to_consume' } }),
      fallback: () => '/movies/search',
      sameOrigin: SAME_ORIGIN,
    },
    {
      name: 'movies.rematch',
      request: async () => ({ path: `/movies/${itemId}/rematch`, body: { catalog_link: '' } }),
      fallback: () => `/movies/${itemId}`,
      sameOrigin: SAME_ORIGIN,
    },
  ]

  for (const { name, request, fallback, sameOrigin } of cases) {
    describe(name, () => {
      for (const value of OFF_SITE) {
        it(`ignores an off-site return_to (${value})`, async () => {
          const { path, body } = await request()
          const response = await post(path, { ...body, return_to: value }, cookie)
          assert.equal(response.status, 303)
          assert.ok(response.location, 'expected a redirect target')
          // Rematch adds its own `?rematchError=` to wherever it lands.
          assert.equal(response.location!.split(/[?&]rematchError=/)[0], fallback())
        })
      }

      it('honours a same-origin return_to', async () => {
        const { path, body } = await request()
        const response = await post(path, { ...body, return_to: sameOrigin }, cookie)
        assert.equal(response.status, 303)
        assert.equal(response.location!.split(/&rematchError=/)[0], sameOrigin)
      })
    })
  }
})
