import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { hashPassword } from '../app/actions/auth/password.ts'
import { createBatch } from '../app/data/imports/batches.ts'
import { db, pool } from '../app/data/db.ts'
import { get, ORIGIN, post, sessionCookieFrom } from './support/router.ts'
import { deleteUsers, insertUser, skipWithoutDatabase, type TestUser } from './support/db.ts'

// What the boundary refuses before anything reaches the database: an id in the
// path that isn't one, and a form value no form of ours can send. Each of these
// used to go through as NaN or be quietly ignored.
describe('request validation', { skip: skipWithoutDatabase, concurrency: true }, () => {
  const PASSWORD = 'correct-horse-battery'
  let me: TestUser
  let cookie: string
  let bookBatchId: string
  let bookRowId: number

  before(async () => {
    me = await insertUser('router-validation', await hashPassword(PASSWORD))
    const login = await post('/auth/login', { identifier: me.email, password: PASSWORD })
    cookie = sessionCookieFrom(login)!
    assert.ok(cookie, 'expected the login to start a session')

    bookBatchId = await createBatch(db, me.id, 'book', 'goodreads', [
      { rowIndex: 1, title: 'A Book', year: 2001, rating: null, consumedAt: null },
    ])
    const { rows } = await pool.query<{ id: number }>('select id from import_rows where batch_id = $1', [
      bookBatchId,
    ])
    bookRowId = rows[0]!.id
  })

  after(async () => {
    await deleteUsers([me.id])
    await pool.end()
  })

  describe('an id in the path that is not a positive integer', () => {
    const pages = [
      '/users/abc',
      '/users/0',
      '/users/-3/watched',
      '/users/99999999999/following',
      '/movies/abc',
      '/books/1.5',
      '/recommendations/unconfirmed/abc',
      '/notifications/abc/read',
    ]
    for (const path of pages) {
      it(`404s GET ${path}`, async () => {
        const response = await get(path, cookie)
        assert.equal(response.status, 404)
      })
    }

    // `show` is ':runId' at the end of the map, so anything else under
    // /recommendations that no earlier route claims lands on it.
    it('404s GET /recommendations/not-a-run', async () => {
      assert.equal((await get('/recommendations/not-a-run', cookie)).status, 404)
    })

    for (const path of ['/users/abc/follow', '/users/abc/unfollow']) {
      it(`404s POST ${path}`, async () => {
        assert.equal((await post(path, {}, cookie)).status, 404)
      })
    }

    it('404s an interaction update or delete', async () => {
      const put = await post('/interactions/abc', { _method: 'PUT', status: 'consumed' }, cookie)
      assert.equal(put.status, 404)
      const del = await post('/interactions/abc', { _method: 'DELETE' }, cookie)
      assert.equal(del.status, 404)
    })

    it('404s a log on a non-numeric item', async () => {
      assert.equal((await post('/movies/abc/log', { status: 'consumed' }, cookie)).status, 404)
    })

    it('404s an import row that is not a number', async () => {
      const response = await post(
        `/profile/imports/${bookBatchId}/rows/abc/resolve`,
        { action: 'skip' },
        cookie,
      )
      assert.equal(response.status, 404)
      assert.equal((await get(`/profile/imports/${bookBatchId}/rows/abc/candidates`, cookie)).status, 404)
    })
  })

  describe('generating recommendations', () => {
    const invalid: [string, string][] = [
      ['decade', 'abc'],
      ['decade', '1995'],
      ['decade_relation', 'sideways'],
      ['length', 'epic'],
    ]
    for (const [name, value] of invalid) {
      it(`400s ${name}=${value}`, async () => {
        const response = await post('/recommendations', { mode: 'self', [name]: value }, cookie)
        assert.equal(response.status, 400)
        assert.equal(response.body, 'Invalid request')
      })
    }

    // Nothing is logged, so a request that gets past the schema stops at the
    // empty-log check instead — a 400 too, but a rendered page.
    it('lets "Any" through for every lever', async () => {
      const response = await post(
        '/recommendations',
        { mode: 'self', decade: '', decade_relation: '', length: '' },
        cookie,
      )
      assert.equal(response.status, 400)
      assert.match(response.body, /you have no movies logged/)
    })

    it('400s a lucky draw with an unknown mode', async () => {
      const response = await post('/recommendations/lucky', { mode: 'everyone' }, cookie)
      assert.equal(response.status, 400)
      assert.equal(response.body, 'Invalid request')
    })
  })

  describe('resolving an import row', () => {
    it('400s an action the review page never sends', async () => {
      const response = await post(
        `/profile/imports/${bookBatchId}/rows/${bookRowId}/resolve`,
        { action: 'explode' },
        cookie,
      )
      assert.equal(response.status, 400)
    })

    it('asks for a book, not a film, on a book import', async () => {
      const response = await post(
        `/profile/imports/${bookBatchId}/rows/${bookRowId}/resolve`,
        { action: 'repoint', external_id: '  ' },
        cookie,
      )
      assert.equal(response.status, 303)
      const location = new URL(response.location!, ORIGIN)
      assert.equal(location.pathname, `/profile/imports/${bookBatchId}/review`)
      assert.equal(location.searchParams.get('error'), 'Choose a book first.')
    })
  })
})
