import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { createBatch, loadBatch, loadReview, loadRows, recordMatch } from '../app/data/imports/batches.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// The namesakes matching keeps for a no-year row, written to a jsonb column and
// read back onto the review model. A round trip through the real database,
// because the failure worth catching is the driver's: node-postgres sends a
// bare array as a Postgres array literal, which jsonb rejects, and that failed
// the whole batch.
describe('import row alternates', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let batchId: string

  before(async () => {
    userId = await insertUser('import-alternates')
    batchId = await createBatch(db, userId, 'movie', 'letterboxd', [
      { rowIndex: 2, title: 'Little Women', year: null, rating: 4, consumedAt: null },
    ])
  })

  after(async () => {
    await pool.query('delete from import_rows where batch_id = $1', [batchId])
    await pool.query('delete from import_batches where user_id = $1', [userId])
    await deleteUsers([userId])
    await pool.end()
  })

  it('keeps them in the order matching gave, and reads them back', async () => {
    const [row] = await loadRows(db, batchId)
    const alternates = [
      { externalId: '331482', title: 'Little Women', releaseYear: 2019 },
      { externalId: '9587', title: 'Little Women', releaseYear: 1994 },
    ]

    await recordMatch(db, row!.id, {
      state: 'uncertain',
      reason: 'no_year',
      yearDelta: null,
      externalId: '331482',
      mediaItemId: null,
      alternates,
    })

    const batch = await loadBatch(db, batchId, userId)
    const { model } = await loadReview(db, batch!)
    assert.deepEqual(model.uncertain[0]?.row.alternates, alternates)
    assert.equal(model.uncertain[0]?.row.matchedExternalId, '331482')
  })

  it('reads none when matching had nothing to offer', async () => {
    const [row] = await loadRows(db, batchId)

    await recordMatch(db, row!.id, {
      state: 'uncertain',
      reason: 'no_year',
      yearDelta: null,
      externalId: '331482',
      mediaItemId: null,
      alternates: null,
    })

    const batch = await loadBatch(db, batchId, userId)
    const { model } = await loadReview(db, batch!)
    assert.equal(model.uncertain[0]?.row.alternates, null)
  })
})
