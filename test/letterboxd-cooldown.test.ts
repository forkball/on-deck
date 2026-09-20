import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  syncLetterboxdBeforeRun,
  syncLetterboxdInBackground,
  syncLetterboxdNow,
} from '../app/data/imports/letterboxdSync.ts'
import { users, type User } from '../app/data/schema.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// The cooldown is what stops every page load pulling a ~220KB feed, and it is
// also what makes a diary edit look like it never arrived: nothing re-reads
// Letterboxd for a quarter of an hour, and until Sync now existed there was no
// way to ask it to. So the rule worth pinning is which trigger obeys it.
//
// A database because the cooldown is read off the user row and stamped back
// onto it — the part that decides anything is the write, not the comparison.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('the Letterboxd sync cooldown', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let fetches: number
  const realFetch = globalThis.fetch
  const flag = process.env.LETTERBOXD_FEED_SYNC

  // A feed with nothing in it: every trigger below is measured by whether it
  // reached Letterboxd at all, so what comes back doesn't matter.
  const EMPTY = `<?xml version='1.0'?><rss><channel></channel></rss>`

  const load = async (): Promise<User> => (await db.find(users, userId))!

  const syncedAgo = (ms: number) => db.update(users, userId, { letterboxd_synced_at: Date.now() - ms })

  before(async () => {
    process.env.LETTERBOXD_FEED_SYNC = '1'
    globalThis.fetch = (async () => {
      fetches++
      return new Response(EMPTY, { status: 200 })
    }) as typeof fetch

    userId = await insertUser('cooldown-test')
    await db.update(users, userId, { letterboxd_username: 'someone' })
  })

  after(async () => {
    globalThis.fetch = realFetch
    if (flag === undefined) delete process.env.LETTERBOXD_FEED_SYNC
    else process.env.LETTERBOXD_FEED_SYNC = flag

    await deleteUsers([userId])
    await pool.end()
  })

  it('leaves the feed alone on a page load inside the cooldown', async () => {
    fetches = 0
    await syncedAgo(2 * 60 * 1000)

    // Awaited rather than the background trigger, so the assertion isn't a
    // race: a sync that was going to happen has happened by the time this
    // returns.
    await syncLetterboxdBeforeRun(db, await load())

    assert.equal(fetches, 0)
  })

  it('reads it again once the cooldown has passed', async () => {
    fetches = 0
    await syncedAgo(16 * 60 * 1000)

    await syncLetterboxdBeforeRun(db, await load())

    assert.equal(fetches, 1)
  })

  // The button's whole reason for existing. Someone who has just edited their
  // diary and come here to check is asking a question the cooldown answers
  // with silence.
  it('reads it immediately when a member asks for it', async () => {
    fetches = 0
    await syncedAgo(0)

    const result = await syncLetterboxdNow(db, await load())

    assert.equal(fetches, 1)
    assert.deepEqual(result, { carried: 0, logged: 0, unresolved: 0, deleted: 0 })
  })

  // Skipping the cooldown still stamps it, or a member pressing the button
  // twice would be two full feed fetches — and the background triggers would
  // carry on as if nothing had been read.
  it('restarts the cooldown behind it', async () => {
    fetches = 0
    await syncedAgo(16 * 60 * 1000)

    await syncLetterboxdNow(db, await load())
    await syncLetterboxdBeforeRun(db, await load())

    assert.equal(fetches, 1)
  })

  it('has nothing to sync once the account is disconnected', async () => {
    fetches = 0
    await db.update(users, userId, { letterboxd_username: undefined })

    assert.equal(await syncLetterboxdNow(db, await load()), null)
    assert.equal(fetches, 0)

    await db.update(users, userId, { letterboxd_username: 'someone' })
  })

  it('says nothing and touches nothing while the gate is closed', async () => {
    fetches = 0
    delete process.env.LETTERBOXD_FEED_SYNC
    await syncedAgo(16 * 60 * 1000)

    syncLetterboxdInBackground(db, await load())
    assert.equal(await syncLetterboxdNow(db, await load()), null)

    assert.equal(fetches, 0)
    process.env.LETTERBOXD_FEED_SYNC = '1'
  })
})
