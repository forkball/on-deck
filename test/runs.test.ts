import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { followUser } from '../app/data/follows.ts'
import {
  getRecommendationRun,
  listRecommendationRuns,
  listRecommendationRunsFromOthers,
  saveRun,
} from '../app/data/recommendations/runs.ts'

// These functions used to issue a query per run to build its group label, and
// listRecommendationRuns returned every media type for the caller to discard.
// The counts below are the point of the change, so they are asserted.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run (npm run db:up && npm run db:migrate)'

describe('recommendation run listings', { skip }, () => {
  let viewer: number
  let friend: number
  let stranger: number
  const itemIds: number[] = []

  const newUser = async (tag: string) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { rows: [u] } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1,'x',$2,$3) returning id`,
      [`runs-${tag}-${stamp}@example.test`, `runs-${tag}-${stamp}`, Date.now()],
    )
    return u.id
  }

  // Counts queries issued while `run` executes.
  const countQueries = async <T>(run: () => Promise<T>): Promise<[T, number]> => {
    const real = pool.query.bind(pool)
    let n = 0
    ;(pool as unknown as { query: unknown }).query = (...args: unknown[]) => {
      n++
      return (real as (...a: unknown[]) => unknown)(...args)
    }
    try {
      return [await run(), n]
    } finally {
      ;(pool as unknown as { query: unknown }).query = real
    }
  }

  before(async () => {
    viewer = await newUser('viewer')
    friend = await newUser('friend')
    stranger = await newUser('stranger')
    await followUser(db, viewer, friend)
    await followUser(db, friend, viewer)

    const { rows: [item] } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie','test',$1,'Fixture','{}'::jsonb,$2) returning id`,
      [`runs-item-${Date.now()}`, Date.now()],
    )
    itemIds.push(item.id)

    // Three movie runs and one TV run, all owned by the viewer.
    for (const mediaType of ['movie', 'movie', 'movie', 'tv'] as const) {
      await saveRun(db, {
        requestingUserId: viewer,
        memberUserIds: [viewer, friend],
        mediaType,
        params: { sourceTypes: [mediaType] },
        results: [],
      })
    }
    // One the friend requested the viewer into, and one from a stranger.
    await saveRun(db, {
      requestingUserId: friend,
      memberUserIds: [friend, viewer],
      mediaType: 'movie',
      params: { sourceTypes: ['movie'] },
      results: [],
    })
    await saveRun(db, {
      requestingUserId: stranger,
      memberUserIds: [stranger, viewer],
      mediaType: 'movie',
      params: { sourceTypes: ['movie'] },
      results: [],
    })
  })

  after(async () => {
    for (const id of [viewer, friend, stranger]) {
      if (!id) continue
      await pool.query('delete from recommendation_runs where user_id = $1', [id])
      await pool.query('delete from user_follows where follower_id = $1 or followed_id = $1', [id])
      await pool.query('delete from users where id = $1', [id])
    }
    if (itemIds.length) await pool.query('delete from media_items where id = any($1)', [itemIds])
    await pool.end()
  })

  it('returns only the requested media type', async () => {
    const movies = await listRecommendationRuns(db, viewer, 'movie')
    const tv = await listRecommendationRuns(db, viewer, 'tv')
    assert.equal(movies.length, 3)
    assert.equal(tv.length, 1)
    assert.ok(movies.every((run) => run.mediaType === 'movie'))
  })

  it('still returns every type when none is given', async () => {
    assert.equal((await listRecommendationRuns(db, viewer)).length, 4)
  })

  it('labels the group from the other members', async () => {
    for (const run of await listRecommendationRuns(db, viewer, 'movie')) {
      assert.match(run.groupLabel, /^You \+ runs-friend-/)
    }
  })

  it('says "Just you" for a solo run', async () => {
    const runId = await saveRun(db, {
      requestingUserId: viewer,
      memberUserIds: [viewer],
      mediaType: 'book',
      params: { sourceTypes: ['book'] },
      results: [],
    })
    const [solo] = await listRecommendationRuns(db, viewer, 'book')
    assert.equal(solo.groupLabel, 'Just you')
    assert.equal((await getRecommendationRun(db, runId, viewer))?.groupLabel, 'Just you')
  })

  it('does not scale its query count with the number of runs', async () => {
    const [, queries] = await countQueries(() => listRecommendationRuns(db, viewer, 'movie'))
    // One for the runs, one for their members, one for the member users.
    assert.ok(queries <= 3, `expected a fixed number of queries, got ${queries}`)
  })

  it('shows a mutual follower run and hides a stranger one', async () => {
    const fromOthers = await listRecommendationRunsFromOthers(db, viewer, 'movie')
    assert.equal(fromOthers.length, 1)
    assert.match(fromOthers[0].groupLabel, /runs-friend-/)
  })

  it('keeps the stranger run reachable by URL, since membership is permanent', async () => {
    const strangerRun = (
      await pool.query<{ id: number }>('select id from recommendation_runs where user_id = $1', [stranger])
    ).rows[0]
    assert.ok(await getRecommendationRun(db, strangerRun.id, viewer))
  })

  it('refuses a run the viewer was never in', async () => {
    const outsider = await newUser('outsider')
    const runId = await saveRun(db, {
      requestingUserId: outsider,
      memberUserIds: [outsider],
      mediaType: 'movie',
      params: { sourceTypes: ['movie'] },
      results: [],
    })
    assert.equal(await getRecommendationRun(db, runId, viewer), null)
    await pool.query('delete from recommendation_runs where user_id = $1', [outsider])
    await pool.query('delete from users where id = $1', [outsider])
  })
})
