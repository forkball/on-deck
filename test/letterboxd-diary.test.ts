import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { syncLetterboxdDiary } from '../app/data/imports/letterboxdSync.ts'
import { users } from '../app/data/schema.ts'
import { getUserInteractionForItem } from '../app/data/mediaItems.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// The round trip the delete pass made possible, driven through the real
// upsert and the real delete rather than through selectRemovable on its own:
// log a film on Letterboxd, delete it there, then log it again.
//
// The middle step is covered by letterboxd-sync.test.ts as a rule. What only a
// database shows is the third: the row is gone, so the write that brings it
// back is an insert rather than the update every other sync performs, and it
// has to survive the delete pass running directly after it in the same sync.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('syncing a diary that changed', { skip: skipWithoutDatabase }, () => {
  const FILM = '891621'
  // Two entries nobody touches, so the feed always has a floor below the film
  // under test — an empty feed is refused outright, and a feed whose oldest
  // entry is the one in question can't speak for it.
  const OTHERS = ['111', '222']

  let userId: number
  const itemIds = new Map<string, number>()
  let body = ''
  const realFetch = globalThis.fetch

  function item(tmdbId: string, guid: number, pubDate: string, watched: string) {
    return `<item> <guid isPermaLink="false">letterboxd-watch-${guid}</guid> <pubDate>${pubDate}</pubDate> <letterboxd:watchedDate>${watched}</letterboxd:watchedDate> <letterboxd:filmTitle>Film ${tmdbId}</letterboxd:filmTitle> <letterboxd:filmYear>2026</letterboxd:filmYear> <tmdb:movieId>${tmdbId}</tmdb:movieId> </item>`
  }

  const OLDER = [
    item('111', 1, 'Mon, 1 Sep 2026 10:00:00 +0000', '2026-08-31'),
    item('222', 2, 'Tue, 2 Sep 2026 10:00:00 +0000', '2026-09-01'),
  ]

  const feed = (items: string[]) => `<?xml version='1.0'?><rss><channel>${items.join('')}</channel></rss>`

  const row = () => getUserInteractionForItem(db, userId, itemIds.get(FILM)!)

  before(async () => {
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch

    userId = await insertUser('diary-test')

    // Seeded so resolveMovie finds them and the sync never reaches TMDB — the
    // catalog lookup is not what is under test here.
    for (const externalId of [FILM, ...OTHERS]) {
      const stamp = Date.now()
      const {
        rows: [item],
      } = await pool.query<{ id: number }>(
        `insert into media_items (type, external_source, external_id, title, metadata, created_at)
         values ('movie', 'tmdb', $1, $2, '{}'::jsonb, $3) returning id`,
        [`${externalId}-diary-${stamp}`, `Film ${externalId}`, stamp],
      )
      itemIds.set(externalId, item!.id)
    }
  })

  after(async () => {
    globalThis.fetch = realFetch
    await deleteUsers([userId])
    for (const id of itemIds.values()) await pool.query('delete from media_items where id = $1', [id])
    // The pool is shared across this file, so only the last suite closes it.
  })

  // The external ids are stamped to keep concurrent runs apart, so the feed
  // has to name what was actually seeded.
  const external = (tmdbId: string) => {
    const id = itemIds.get(tmdbId)!
    return pool
      .query<{ external_id: string }>('select external_id from media_items where id = $1', [id])
      .then(({ rows }) => rows[0]!.external_id)
  }

  it('logs, removes and logs the same film again', async () => {
    const film = await external(FILM)
    const others = await Promise.all(OTHERS.map(external))
    const older = [
      item(others[0]!, 1, 'Mon, 1 Sep 2026 10:00:00 +0000', '2026-08-31'),
      item(others[1]!, 2, 'Tue, 2 Sep 2026 10:00:00 +0000', '2026-09-01'),
    ]

    body = feed([item(film, 10, 'Wed, 10 Sep 2026 12:00:00 +0000', '2026-09-10'), ...older])
    assert.deepEqual(await syncLetterboxdDiary(db, userId, 'someone'), {
      logged: 3,
      unresolved: 0,
      deleted: 0,
    })
    assert.equal((await row())?.source, 'letterboxd-feed')

    // Deleted on Letterboxd.
    body = feed(older)
    assert.equal((await syncLetterboxdDiary(db, userId, 'someone')).deleted, 1)
    assert.equal(await row(), null)

    // Logged again: a new diary entry, so a new guid and a later pubDate.
    body = feed([item(film, 11, 'Thu, 11 Sep 2026 12:00:00 +0000', '2026-09-11'), ...older])
    assert.deepEqual(await syncLetterboxdDiary(db, userId, 'someone'), {
      logged: 3,
      unresolved: 0,
      deleted: 0,
    })

    const back = await row()
    assert.ok(back, 'a film logged again on Letterboxd has to come back')
    assert.equal(back.status, 'consumed')
    // Re-stamped from the new entry, not left on the deleted one's date.
    assert.equal(back.source_entry_at, Date.parse('Thu, 11 Sep 2026 12:00:00 +0000'))
  })

  // The same day, which is the shape a member testing this produces: both
  // edits land between two syncs, so the row is updated rather than deleted
  // and re-inserted.
  it('follows a delete and a re-log that share one sync', async () => {
    const film = await external(FILM)
    const others = await Promise.all(OTHERS.map(external))
    const older = [
      item(others[0]!, 1, 'Mon, 1 Sep 2026 10:00:00 +0000', '2026-08-31'),
      item(others[1]!, 2, 'Tue, 2 Sep 2026 10:00:00 +0000', '2026-09-01'),
    ]

    body = feed([item(film, 12, 'Fri, 12 Sep 2026 12:00:00 +0000', '2026-09-12'), ...older])
    assert.equal((await syncLetterboxdDiary(db, userId, 'someone')).deleted, 0)
    assert.equal((await row())?.source_entry_at, Date.parse('Fri, 12 Sep 2026 12:00:00 +0000'))
  })
})

// The bottom of the window, where the watermark used to eat itself: deleting
// the oldest entry the feed shows raises the line past the row that just went.
//
// Both directions matter and they look identical in the current fetch — the
// floor rose either way. Only the previous fetch says which happened, so both
// are driven end to end here rather than against the rule alone.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('the oldest entry the feed carries', { skip: skipWithoutDatabase }, () => {
  let userId: number
  const ids = new Map<string, number>()
  let body = ''
  const realFetch = globalThis.fetch
  const stamp = Date.now()

  const ext = (name: string) => `window-${stamp}-${name}`

  function item(name: string, guid: number, pubDate: string) {
    return `<item> <guid isPermaLink="false">letterboxd-watch-${guid}</guid> <pubDate>${pubDate}</pubDate> <letterboxd:watchedDate>2026-09-01</letterboxd:watchedDate> <letterboxd:filmTitle>${name}</letterboxd:filmTitle> <tmdb:movieId>${ext(name)}</tmdb:movieId> </item>`
  }
  const feed = (items: string[]) => `<?xml version='1.0'?><rss><channel>${items.join('')}</channel></rss>`

  const NEWEST = item('newest', 1, 'Wed, 10 Sep 2026 12:00:00 +0000')
  const MIDDLE = item('middle', 2, 'Tue, 09 Sep 2026 12:00:00 +0000')
  const OLDEST = item('oldest', 3, 'Mon, 08 Sep 2026 12:00:00 +0000')
  const FRESH = item('fresh', 4, 'Thu, 11 Sep 2026 12:00:00 +0000')

  const present = async (name: string) =>
    (await getUserInteractionForItem(db, userId, ids.get(name)!)) != null

  before(async () => {
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch
    userId = await insertUser('window-test')

    for (const name of ['newest', 'middle', 'oldest', 'fresh']) {
      const {
        rows: [row],
      } = await pool.query<{ id: number }>(
        `insert into media_items (type, external_source, external_id, title, metadata, created_at)
         values ('movie', 'tmdb', $1, $2, '{}'::jsonb, $3) returning id`,
        [ext(name), name, stamp],
      )
      ids.set(name, row!.id)
    }
  })

  after(async () => {
    globalThis.fetch = realFetch
    await deleteUsers([userId])
    for (const id of ids.values()) await pool.query('delete from media_items where id = $1', [id])
    await pool.end()
  })

  const reset = () => pool.query('delete from user_media_interactions where user_id = $1', [userId])

  it('is removed when the feed lost it and nothing refilled', async () => {
    await reset()

    body = feed([NEWEST, MIDDLE, OLDEST])
    await syncLetterboxdDiary(db, userId, 'someone')
    assert.equal(await present('oldest'), true)

    // Three items became two, so nothing was pushed out — the entry is gone.
    body = feed([NEWEST, MIDDLE])
    assert.equal((await syncLetterboxdDiary(db, userId, 'someone')).deleted, 1)
    assert.equal(await present('oldest'), false)
  })

  // The refusal the whole watermark exists for, and the one the widening must
  // not cost. The feed is full at three, a fourth entry arrives, and the oldest
  // falls off the bottom — same rising floor as above, opposite meaning.
  it('is left alone when a new entry pushed it out of a full feed', async () => {
    await reset()

    body = feed([NEWEST, MIDDLE, OLDEST])
    await syncLetterboxdDiary(db, userId, 'someone')

    body = feed([FRESH, NEWEST, MIDDLE])
    assert.equal((await syncLetterboxdDiary(db, userId, 'someone')).deleted, 0)
    assert.equal(await present('oldest'), true, 'a truncated entry is out of view, not deleted')
  })

  // A first sync has nothing to compare against, so it can only answer for what
  // it can see — the conservative branch, and the one every existing member
  // lands on the first time this runs.
  it('is left alone when there is no previous fetch to compare against', async () => {
    await reset()
    await db.update(users, userId, { letterboxd_feed_floor: undefined, letterboxd_feed_items: undefined })

    body = feed([NEWEST, MIDDLE, OLDEST])
    await syncLetterboxdDiary(db, userId, 'someone')
    await db.update(users, userId, { letterboxd_feed_floor: undefined, letterboxd_feed_items: undefined })

    body = feed([NEWEST, MIDDLE])
    assert.equal((await syncLetterboxdDiary(db, userId, 'someone')).deleted, 0)
    assert.equal(await present('oldest'), true)
  })
})
