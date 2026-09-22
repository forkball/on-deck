import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { loadFeedPage, type FeedCursor, type FeedItem } from '../app/data/feed.ts'
import { followUser } from '../app/data/follows.ts'
import { saveRun } from '../app/data/recommendations/runs.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// The home page's activity feed: three lists merged into one, paged as a whole.
//
// The paging is what these are really about. Each source keeps its own cursor
// and only advances it as far as the rows that actually made the page, so the
// hazards worth asserting are the two a shared cursor would produce — a row
// served twice, and a row skipped because another source overtook it.
describe('activity feed', { skip: skipWithoutDatabase }, () => {
  let viewer: number
  let friend: number
  const itemIds: number[] = []
  const runIds: number[] = []

  // One timeline for everything, so runs and log rows interleave predictably.
  const stamp = Date.now() - 1_000_000

  const newItem = async (title: string) => {
    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie','test',$1,$2,'{}'::jsonb,$3) returning id`,
      [`feedpage-${title}-${Date.now()}-${Math.random()}`, title, Date.now()],
    )
    itemIds.push(item.id)
    return item.id
  }

  const log = (userId: number, itemId: number, updatedAt: number) =>
    pool.query(
      `insert into user_media_interactions (user_id, media_item_id, status, created_at, updated_at)
       values ($1,$2,'consumed',$3,$4)`,
      [userId, itemId, updatedAt, updatedAt],
    )

  // saveRun stamps created_at itself, so the timeline is set afterwards.
  const runAt = async (ownerId: number, members: number[], at: number, name: string) => {
    const runId = await saveRun(db, {
      requestingUserId: ownerId,
      memberUserIds: members,
      mediaType: 'movie',
      name,
      params: { sourceTypes: ['movie'] },
      results: [],
    })
    await pool.query('update recommendation_runs set created_at = $1 where id = $2', [at, runId])
    runIds.push(runId)
    return runId
  }

  // Every page, walked to the end, as one list.
  const drain = async (limit: number): Promise<FeedItem[]> => {
    const all: FeedItem[] = []
    let cursor: FeedCursor | undefined
    // Bounded so a cursor that fails to advance fails the test rather than
    // hanging it.
    for (let guard = 0; guard < 50; guard++) {
      const page = await loadFeedPage(db, viewer, limit, cursor)
      all.push(...page.items)
      if (!page.cursor) return all
      cursor = page.cursor
    }
    assert.fail('feed never reported an end')
  }

  const key = (item: FeedItem) => `${item.kind}-${item.id}`

  before(async () => {
    viewer = await insertUser('feedpage-viewer')
    friend = await insertUser('feedpage-friend')
    await followUser(db, viewer, friend)
    await followUser(db, friend, viewer)

    // Six of the friend's log rows and four runs, interleaved in time: two the
    // viewer generated, two the friend generated with the viewer in them.
    for (let i = 0; i < 6; i++) await log(friend, await newItem(`Logged ${i}`), stamp + i * 10)
    await runAt(viewer, [viewer], stamp + 5, 'Mine A')
    await runAt(viewer, [viewer], stamp + 25, 'Mine B')
    await runAt(friend, [friend, viewer], stamp + 15, 'Theirs A')
    await runAt(friend, [friend, viewer], stamp + 45, 'Theirs B')
  })

  after(async () => {
    if (runIds.length) await pool.query('delete from recommendation_runs where id = any($1)', [runIds])
    await deleteUsers([viewer, friend])
    if (itemIds.length) await pool.query('delete from media_items where id = any($1)', [itemIds])
    await pool.end()
  })

  it('merges runs and logged activity into one list, newest first', async () => {
    const { items } = await loadFeedPage(db, viewer, 20)

    assert.equal(items.length, 10)
    assert.ok(
      items.some((item) => item.kind === 'run'),
      'expected runs in the feed',
    )
    assert.ok(
      items.some((item) => item.kind === 'log'),
      'expected logged activity in the feed',
    )

    const times = items.map((item) => item.at)
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a),
      'feed is not newest-first',
    )
  })

  it('says who generated a run, and says nothing for your own', async () => {
    const { items } = await loadFeedPage(db, viewer, 20)
    const runs = items.filter((item) => item.kind === 'run')

    const mine = runs.filter((item) => item.kind === 'run' && item.run.owner === null)
    const theirs = runs.filter((item) => item.kind === 'run' && item.run.owner !== null)

    assert.equal(mine.length, 2)
    assert.equal(theirs.length, 2)
    for (const item of theirs) {
      assert.ok(item.kind === 'run' && item.run.owner)
      assert.match(item.run.owner.label, /^feedpage-friend-/)
    }
  })

  it('pages to the same list it returns whole, without repeating or skipping', async () => {
    const whole = await loadFeedPage(db, viewer, 50)
    assert.equal(whole.cursor, null, 'a page big enough for everything should end the feed')

    // Small pages are the interesting case: every page boundary is a chance for
    // one source to overtake another and strand a row.
    for (const limit of [1, 2, 3, 4, 7]) {
      const paged = await drain(limit)
      assert.deepEqual(
        paged.map(key),
        whole.items.map(key),
        `paging at ${limit} did not reproduce the whole feed`,
      )
      assert.equal(new Set(paged.map(key)).size, paged.length, `paging at ${limit} repeated a row`)
    }
  })

  it('keeps rows that share a timestamp, which an import routinely produces', async () => {
    const tied = Date.now()
    // Three log rows stamped the same millisecond, the shape a bulk import
    // writes: a cursor without a tiebreaker loses two of them at a page edge.
    for (let i = 0; i < 3; i++) await log(friend, await newItem(`Tied ${i}`), tied)

    const paged = await drain(1)
    const titles = paged
      .filter((item) => item.kind === 'log')
      .map((item) => (item.kind === 'log' ? item.entry.item?.title : null))

    for (const expected of ['Tied 0', 'Tied 1', 'Tied 2']) {
      assert.ok(titles.includes(expected), `${expected} was dropped at a page boundary`)
    }
    assert.equal(new Set(paged.map(key)).size, paged.length, 'a tied row was served twice')
  })
})
