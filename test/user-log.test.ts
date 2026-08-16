import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  countUserMediaLog,
  listUserMediaLog,
  matchesLogFilter,
  type UserLogFilter,
} from '../app/data/mediaItems.ts'

// listUserMediaLog and countUserMediaLog filter and paginate in SQL. The
// predicate they encode has to stay identical to matchesLogFilter, which is what
// mediaSummary still partitions with — drift between the two shows up as a page
// whose rows and whose pagination disagree.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run (npm run db:up && npm run db:migrate)'

describe('user media log queries', { skip }, () => {
  let userId: number
  const itemIds: number[] = []

  const FIXTURES = [
    ['movie', 'consumed'], ['movie', 'consumed'], ['movie', 'want_to_consume'],
    ['movie', 'not_interested'], ['book', 'consumed'], ['book', 'consumed'],
    ['book', 'want_to_consume'], ['book', 'not_interested'], ['tv', 'consumed'],
    ['tv', 'in_progress'], ['game', 'consumed'], ['game', 'not_interested'],
  ] as const

  before(async () => {
    const stamp = Date.now()
    const { rows: [user] } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1, 'x', $2, $3) returning id`,
      [`log-test-${stamp}@example.test`, `log-test-${stamp}`, stamp],
    )
    userId = user.id

    for (const [index, [type, status]] of FIXTURES.entries()) {
      const { rows: [item] } = await pool.query<{ id: number }>(
        `insert into media_items (type, external_source, external_id, title, metadata, created_at)
         values ($1, 'test', $2, $3, '{}'::jsonb, $4) returning id`,
        [type, `log-test-${stamp}-${index}`, `Title ${index}`, stamp],
      )
      itemIds.push(item.id)
      await pool.query(
        `insert into user_media_interactions (user_id, media_item_id, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5)`,
        // Two rows share each updated_at, so ordering has real ties to break.
        [userId, item.id, status, stamp, stamp + Math.floor(index / 2)],
      )
    }
  })

  after(async () => {
    if (userId) {
      await pool.query('delete from user_media_interactions where user_id = $1', [userId])
      await pool.query('delete from users where id = $1', [userId])
    }
    if (itemIds.length) await pool.query('delete from media_items where id = any($1)', [itemIds])
    await pool.end()
  })

  const FILTERS: UserLogFilter[] = [
    {},
    { type: 'movie' },
    { type: 'book' },
    { type: 'game' },
    { statuses: ['consumed'] },
    { statuses: ['consumed', 'want_to_consume'] },
    { type: 'movie', statuses: ['consumed'] },
    { type: 'book', statuses: ['not_interested'] },
    { type: 'tv', statuses: ['consumed', 'in_progress'] },
  ]

  const ids = (entries: Awaited<ReturnType<typeof listUserMediaLog>>) =>
    entries.map((entry) => entry.interaction.id).sort((a, b) => a - b)

  it('matches the in-memory predicate for every filter shape', async () => {
    const baseline = await listUserMediaLog(db, userId)
    assert.equal(baseline.length, FIXTURES.length)

    for (const filter of FILTERS) {
      const expected = baseline.filter((entry) => matchesLogFilter(entry, filter))
      const actual = await listUserMediaLog(db, userId, filter)
      assert.deepEqual(ids(actual), ids(expected), `filter ${JSON.stringify(filter)}`)
    }
  })

  it('counts what it lists, for every filter shape', async () => {
    for (const filter of FILTERS) {
      const listed = await listUserMediaLog(db, userId, filter)
      const counted = await countUserMediaLog(db, userId, filter)
      assert.equal(counted, listed.length, `filter ${JSON.stringify(filter)}`)
    }
  })

  it('resolves the joined item, so a type filter has something to read', async () => {
    for (const entry of await listUserMediaLog(db, userId, { type: 'movie' })) {
      assert.equal(entry.item?.type, 'movie')
      assert.ok(entry.item?.title)
    }
  })

  it('orders most recently updated first', async () => {
    const stamps = (await listUserMediaLog(db, userId)).map((e) => Number(e.interaction.updated_at))
    assert.deepEqual(stamps, [...stamps].sort((a, b) => b - a))
  })

  it('pages without repeating or skipping a row, even across tied timestamps', async () => {
    const all = await listUserMediaLog(db, userId)
    const seen: number[] = []
    for (let offset = 0; offset < all.length; offset += 5) {
      const page = await listUserMediaLog(db, userId, { limit: 5, offset })
      seen.push(...page.map((e) => e.interaction.id))
    }
    assert.deepEqual(seen, all.map((e) => e.interaction.id))
    assert.equal(new Set(seen).size, all.length, 'a row was repeated across pages')
  })

  it('pages a filtered list against its own count', async () => {
    const filter: UserLogFilter = { type: 'movie' }
    const total = await countUserMediaLog(db, userId, filter)
    const pageSize = 3
    const lastOffset = Math.floor((total - 1) / pageSize) * pageSize
    const lastPage = await listUserMediaLog(db, userId, { ...filter, limit: pageSize, offset: lastOffset })
    assert.ok(lastPage.length > 0, 'the last page implied by the count must not be empty')
  })

  it('returns nothing for a user with no log', async () => {
    assert.deepEqual(await listUserMediaLog(db, -1), [])
    assert.equal(await countUserMediaLog(db, -1), 0)
  })
})
