import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { pool } from '../app/data/db.ts'
import { hashPassword } from '../app/actions/auth/password.ts'
import { get, post, sessionCookieFrom } from './support/router.ts'
import { deleteUsers, skipWithoutDatabase } from './support/db.ts'

// The login route at the HTTP boundary, which is where its interesting failures
// are: what a malformed body does, what a wrong password does, and where a
// successful login is allowed to send you. These go through the real router, so
// the middleware stack — form data, session, auth — is under test too, not just
// the controller function.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('login route', { skip: skipWithoutDatabase }, () => {
  const PASSWORD = 'correct-horse-battery'
  const userIds: number[] = []
  let email: string
  let displayName: string

  before(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    email = `router-login-${stamp}@example.test`
    displayName = `router-login-${stamp}`

    const { rows } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1, $2, $3, $4) returning id`,
      [email, await hashPassword(PASSWORD), displayName, Date.now()],
    )
    userIds.push(rows[0]!.id)
  })

  after(async () => {
    await deleteUsers(userIds)
  })

  // Both fields are `s.defaulted(s.string(), '')`, so a missing one is not
  // malformed — it defaults to empty and falls through to the 401 below. These
  // two pin that down, because it is the reason the interesting case is the
  // next one rather than this one.
  it('answers a body with no fields at all', async () => {
    const response = await post('/auth/login', '')
    assert.equal(response.status, 401)
    assert.match(response.body, /Invalid email\/username or password/)
  })

  it('answers a body missing just the password', async () => {
    const response = await post('/auth/login', { identifier: email })
    assert.equal(response.status, 401)
  })

  it('refuses a wrong password without setting a session', async () => {
    const response = await post('/auth/login', { identifier: email, password: 'wrong' })
    assert.equal(response.status, 401)
    assert.equal(sessionCookieFrom(response), null)
  })

  it('refuses an unknown identifier', async () => {
    const response = await post('/auth/login', { identifier: 'nobody@example.test', password: PASSWORD })
    assert.equal(response.status, 401)
  })

  it('accepts the right password and starts a session', async () => {
    const response = await post('/auth/login', { identifier: email, password: PASSWORD })
    assert.equal(response.status, 303)
    assert.notEqual(sessionCookieFrom(response), null)
  })

  // Emails are stored lowercased, so the email arm lowercases what was typed.
  // Display names are stored as written and matched as written.
  it('matches an email typed with capitals, and a display name as written', async () => {
    const byEmail = await post('/auth/login', { identifier: email.toUpperCase(), password: PASSWORD })
    assert.equal(byEmail.status, 303)

    const byName = await post('/auth/login', { identifier: displayName, password: PASSWORD })
    assert.equal(byName.status, 303)
  })

  // `return_to` arrives in the form body and is untrusted. safeReturnTo is unit
  // material, but only a request proves it is actually wired into the redirect.
  describe('return_to', () => {
    const offSite = ['//evil.test/path', 'https://evil.test/path', 'javascript:alert(1)', 'evil.test']

    for (const value of offSite) {
      it(`ignores an off-site return_to (${value})`, async () => {
        const response = await post('/auth/login', { identifier: email, password: PASSWORD, return_to: value })
        assert.equal(response.status, 303)
        assert.ok(response.location, 'expected a redirect target')
        assert.ok(
          response.location!.startsWith('/') && !response.location!.startsWith('//'),
          `expected a same-origin relative path, got ${response.location}`,
        )
      })
    }

    it('honours a same-origin relative return_to', async () => {
      const response = await post('/auth/login', {
        identifier: email,
        password: PASSWORD,
        return_to: '/profile/watched?page=2',
      })
      assert.equal(response.status, 303)
      assert.equal(response.location, '/profile/watched?page=2')
    })
  })
})

// Boundary behaviour that belongs to the router itself rather than to any one
// controller. None of it touches the database, so it runs without one.
describe('router boundary', () => {
  it('renders the login form', async () => {
    const response = await get('/auth/login')
    assert.equal(response.status, 200)
    assert.match(response.body, /name="identifier"/)
    assert.match(response.body, /name="password"/)
  })

  it('sends an unauthenticated reader to login, remembering where they were', async () => {
    const response = await get('/recommendations')
    assert.equal(response.status, 303)
    assert.ok(response.location?.startsWith('/auth/login'), `got ${response.location}`)
    const next = new URL(response.location!, 'http://router.test').searchParams.get('next')
    assert.equal(next, '/recommendations')
  })

  it('404s a path no route claims', async () => {
    assert.equal((await get('/nope')).status, 404)
    assert.equal((await get('/movies/nope/deeper')).status, 404)
  })

  it('does not serve a POST-only route over GET', async () => {
    // `log` is POST-only. Answering it on GET would mean a link could write.
    const response = await get('/movies/1/log')
    assert.notEqual(response.status, 200)
  })
})
