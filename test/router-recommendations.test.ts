import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { hashPassword } from '../app/actions/auth/password.ts'
import { db, pool } from '../app/data/db.ts'
import { followUser } from '../app/data/follows.ts'
import { post, sessionCookieFrom } from './support/router.ts'
import { deleteUsers, insertUser, skipWithoutDatabase, type TestUser } from './support/db.ts'

// Who a run may be built from. The friend picker only offers people you follow,
// but the ids arrive in the form body, so a hand-built request can name anyone —
// a private account included. Both run actions have to drop those ids, and only
// a request proves the check is wired into each of them.
//
// Nobody here has anything logged, so a request that gets past the friend check
// stops at "has no movies logged" and names who it would have included. That is
// how these tell a friend kept from a friend dropped without starting a run.
describe('friends in a run', { skip: skipWithoutDatabase, concurrency: true }, () => {
  const PASSWORD = 'correct-horse-battery'
  let friend: TestUser
  let stranger: TestUser
  let userIds: number[] = []
  let cookie: string

  before(async () => {
    const me = await insertUser('router-runs', await hashPassword(PASSWORD))
    friend = await insertUser('router-runs-friend')
    stranger = await insertUser('router-runs-stranger')
    userIds = [me.id, friend.id, stranger.id]
    await followUser(db, me.id, friend.id)

    const login = await post('/auth/login', { identifier: me.email, password: PASSWORD })
    cookie = sessionCookieFrom(login)!
    assert.ok(cookie, 'expected the login to start a session')
  })

  after(async () => {
    await deleteUsers(userIds)
    await pool.end()
  })

  for (const path of ['/recommendations', '/recommendations/lucky']) {
    describe(path, () => {
      it('refuses a group of nobody but someone you do not follow', async () => {
        const response = await post(
          path,
          [
            ['mode', 'group'],
            ['friend_ids', String(stranger.id)],
          ],
          cookie,
        )
        assert.equal(response.status, 400)
        assert.match(response.body, /Tick at least one friend/)
        assert.ok(!response.body.includes(stranger.displayName), 'the stranger should not be named')
      })

      it('keeps the friend you follow and drops the stranger beside them', async () => {
        const response = await post(
          path,
          [
            ['mode', 'group'],
            ['friend_ids', String(friend.id)],
            ['friend_ids', String(stranger.id)],
          ],
          cookie,
        )
        assert.equal(response.status, 400)
        assert.ok(response.body.includes(friend.displayName), 'the friend should be in the run')
        assert.ok(!response.body.includes(stranger.displayName), 'the stranger should not be')
      })
    })
  }
})
