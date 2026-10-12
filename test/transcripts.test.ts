import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  finishTranscript,
  MAX_TRANSCRIPTS_PER_USER,
  startTranscript,
} from '../app/data/recommendations/transcripts.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// The point of these rows is being readable after the run they describe is gone,
// so what's asserted is that they survive the cases where there is no run.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('generation transcripts', { skip: skipWithoutDatabase }, () => {
  const created: number[] = []
  let userId: number

  const start = (id: number, prompt: string) =>
    startTranscript(db, {
      userId: id,
      jobId: 'job-1',
      mediaType: 'book',
      filters: { genre: 'romance' },
      prompt,
      response: '{"picks":[]}',
    })

  const read = async (id: number) =>
    (
      await pool.query<{ prompt: string; tally: string | null; run_id: number | null }>(
        'select prompt, tally, run_id from generation_transcripts where id = $1',
        [id],
      )
    ).rows[0]

  before(async () => {
    userId = await insertUser('transcript-owner')
    created.push(userId)
  })

  after(async () => {
    await pool.query('delete from generation_transcripts where user_id = any($1)', [created])
    await deleteUsers(created)
    await pool.end()
  })

  it('keeps what was asked before anything is done with the answer', async () => {
    const id = await start(userId, 'a prompt')
    const row = await read(id)

    assert.equal(row.prompt, 'a prompt')
    // Null until the run is over — the row exists first precisely so a run that
    // never gets there still leaves one.
    assert.equal(row.tally, null)
    assert.equal(row.run_id, null)
  })

  it('records where the picks went, with no run to point at', async () => {
    const id = await start(userId, 'a prompt')
    await finishTranscript(db, id, {
      tally: {
        requested: 18,
        kept: 0,
        surplus: 0,
        dropped: {
          unfound: 6,
          alreadyLogged: 0,
          duplicate: 0,
          sameSeries: 0,
          titleMismatch: 0,
          filtered: 0,
          genre: 1,
          length: 0,
          unverified: 11,
        },
      },
    })

    const row = await read(id)
    assert.equal(row.run_id, null)
    assert.equal(JSON.parse(row.tally ?? '{}').dropped.unverified, 11)
  })

  it('will not fail a run over its own record of itself', async () => {
    // No such transcript. The run it belonged to still has to finish.
    await finishTranscript(db, 999_999_999, {
      tally: {
        requested: 1,
        kept: 1,
        surplus: 0,
        dropped: {
          unfound: 0,
          alreadyLogged: 0,
          duplicate: 0,
          sameSeries: 0,
          titleMismatch: 0,
          filtered: 0,
          genre: 0,
          length: 0,
          unverified: 0,
        },
      },
    })
  })

  it('keeps only the most recent few', async () => {
    const fresh = await insertUser('transcript-pruned')
    created.push(fresh)

    for (let i = 0; i < MAX_TRANSCRIPTS_PER_USER + 2; i++) {
      await start(fresh, `prompt ${i}`)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    const { rows } = await pool.query<{ count: string }>(
      'select count(*) from generation_transcripts where user_id = $1',
      [fresh],
    )
    assert.equal(Number(rows[0].count), MAX_TRANSCRIPTS_PER_USER)
  })
})
