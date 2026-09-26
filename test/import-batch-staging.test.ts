import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { createBatch, loadBatch, loadRows } from '../app/data/imports/batches.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// A batch is written before its rows, and a worker polling in the gap used to
// claim it empty and send it to review with every row pending. createBatch
// now holds the claim while the rows go in; what can be checked from outside
// is that it lets go afterwards, or no worker would pick the batch up until the
// claim went stale.
describe('staging an import batch', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let batchId: string

  before(async () => {
    userId = await insertUser('import-staging')
    batchId = await createBatch(db, userId, 'movie', 'letterboxd', [
      { rowIndex: 2, title: 'Heat', year: 1995, rating: 4.5, consumedAt: null },
      { rowIndex: 3, title: 'Dune', year: null, rating: 3, consumedAt: null },
    ])
  })

  after(async () => {
    await pool.query('delete from import_rows where batch_id = $1', [batchId])
    await pool.query('delete from import_batches where user_id = $1', [userId])
    await deleteUsers([userId])
    await pool.end()
  })

  it('has every row in and the batch unclaimed once it returns', async () => {
    const batch = await loadBatch(db, batchId, userId)
    assert.equal(batch?.status, 'matching')
    assert.equal(batch?.claimed_at, null)
    assert.equal((await loadRows(db, batchId)).length, 2)
  })
})
