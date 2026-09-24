import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { completeJob, enqueueJob, failJob, getJob, requeueJob } from '../app/data/recommendations/jobs.ts'
import { skipWithoutDatabase } from './support/db.ts'

// A user may have one queued-or-running job at a time. The rule is enforced by a
// partial unique index, not by a read before the insert: two requests arriving
// together both pass a prior check, and each run costs several model calls.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('one active job per user', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let otherId: number

  const params = { mediaType: 'movie', filters: {}, sourceTypes: ['movie'] }
  const enqueue = (id: number) => enqueueJob(db, id, { ...params, memberIds: [id] }, { withGenreCheck: false, withLengthCheck: false })

  const newUser = async (tag: string) => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { rows: [u] } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1,'x',$2,$3) returning id`,
      [`jobs-${tag}-${s}@example.test`, `jobs-${tag}-${s}`, Date.now()],
    )
    return u.id
  }

  before(async () => {
    userId = await newUser('a')
    otherId = await newUser('b')
  })

  after(async () => {
    for (const id of [userId, otherId]) {
      if (!id) continue
      await pool.query('delete from recommendation_jobs where user_id = $1', [id])
      await pool.query('delete from users where id = $1', [id])
    }
    await pool.end()
  })

  const clear = () => pool.query('delete from recommendation_jobs where user_id = any($1)', [[userId, otherId]])

  it('accepts the first job', async () => {
    await clear()
    assert.equal((await enqueue(userId)).ok, true)
  })

  it('refuses a second while one is queued', async () => {
    await clear()
    assert.equal((await enqueue(userId)).ok, true)

    const second = await enqueue(userId)
    assert.equal(second.ok, false)
    assert.equal(second.ok === false && second.reason, 'active_job')
  })

  // The reason the index exists: a read before the insert cannot close this
  // window, and each admitted run spends real money.
  it('admits exactly one of eight simultaneous requests', async () => {
    await clear()
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueue(userId)))

    const accepted = results.filter((result) => result.ok)
    assert.equal(accepted.length, 1, `expected exactly one to win, got ${accepted.length}`)

    const { rows } = await pool.query<{ count: string }>(
      `select count(*)::text as count from recommendation_jobs
        where user_id = $1 and status in ('queued','running')`,
      [userId],
    )
    assert.equal(Number(rows[0].count), 1)
  })

  it('does not block a different user', async () => {
    await clear()
    assert.equal((await enqueue(userId)).ok, true)
    assert.equal((await enqueue(otherId)).ok, true)
  })

  it('refuses while the job is running, not only while queued', async () => {
    await clear()
    assert.ok((await enqueue(userId)).ok)
    await pool.query(`update recommendation_jobs set status='running' where user_id=$1`, [userId])

    assert.equal((await enqueue(userId)).ok, false)
  })

  it('lets the next run start once the last one finishes', async () => {
    await clear()
    const first = await enqueue(userId)
    assert.ok(first.ok)

    // completeJob points the row at a real run, so one has to exist.
    const { rows: [run] } = await pool.query<{ id: number }>(
      `insert into recommendation_runs (user_id, media_type, created_at, params)
       values ($1, 'movie', $2, '{}') returning id`,
      [userId, Date.now()],
    )
    await completeJob(db, first.jobId, run.id, false)

    assert.equal((await enqueue(userId)).ok, true)
  })

  it('lets the next run start once the last one failed', async () => {
    await clear()
    const first = await enqueue(userId)
    assert.ok(first.ok)
    await failJob(db, first.jobId, 'nope')

    assert.equal((await enqueue(userId)).ok, true)
  })

  // A stale claim is handed back to the queue; that must not trip the index.
  it('can requeue an interrupted job', async () => {
    await clear()
    const first = await enqueue(userId)
    assert.ok(first.ok)

    await pool.query(`update recommendation_jobs set status='running' where id=$1`, [first.jobId])
    await requeueJob(db, first.jobId)

    assert.equal((await getJob(db, first.jobId, userId))?.status, 'queued')
  })
})
