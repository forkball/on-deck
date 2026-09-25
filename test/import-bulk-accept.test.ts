import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  acceptBulk,
  confirmRow,
  createBatch,
  loadBatch,
  loadRows,
  recordMatch,
  unacceptBulk,
} from '../app/data/imports/batches.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// An accept on the review page can be unticked, which has to give back exactly
// the rows it took — with the reason matching gave them, so they return to the
// same section — and leave a row confirmed by hand alone.
describe('unticking a bulk accept', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let batchId: string

  before(async () => {
    userId = await insertUser('import-bulk-accept')
    batchId = await createBatch(db, userId, 'movie', 'letterboxd', [
      { rowIndex: 2, title: 'Kwaidan', year: 1964, rating: 4, consumedAt: null },
      { rowIndex: 3, title: 'Ran', year: 1984, rating: 5, consumedAt: null },
    ])
    for (const row of await loadRows(db, batchId)) {
      await recordMatch(db, row.id, {
        state: 'uncertain',
        reason: 'year_drift',
        yearDelta: 1,
        externalId: null,
        mediaItemId: null,
      })
    }
  })

  after(async () => {
    await pool.query('delete from import_rows where batch_id = $1', [batchId])
    await pool.query('delete from import_batches where user_id = $1', [userId])
    await deleteUsers([userId])
    await pool.end()
  })

  it('puts back what the accept took and nothing confirmed by hand', async () => {
    const batch = (await loadBatch(db, batchId, userId))!
    const [kwaidan, ran] = await loadRows(db, batchId)

    await confirmRow(db, batch, ran!.id)
    await acceptBulk(db, batch, 'year', [kwaidan!.id])
    assert.equal((await loadRows(db, batchId)).find((row) => row.id === kwaidan!.id)?.accepted_by, 'year')

    await unacceptBulk(db, batch, [kwaidan!.id])

    const after = new Map((await loadRows(db, batchId)).map((row) => [row.id, row]))
    assert.equal(after.get(kwaidan!.id)?.state, 'uncertain')
    assert.equal(after.get(kwaidan!.id)?.reason, 'year_drift')
    assert.equal(after.get(kwaidan!.id)?.year_delta, 1)
    assert.equal(after.get(kwaidan!.id)?.accepted_by, null)
    assert.equal(after.get(ran!.id)?.state, 'confirmed')
  })
})
