import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  createBatch,
  finishMatching,
  loadBatch,
  loadPastAnswers,
  loadReview,
  loadRows,
  recordMatch,
  rememberRow,
  reopenRow,
} from '../app/data/imports/batches.ts'
import { answerKey } from '../app/data/imports/classify.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// A re-uploaded export shouldn't ask what an earlier saved import already
// answered: only questions review asked, only from saved imports, only this
// member's, and only while the film is still in the catalog.
describe('remembering past import answers', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let otherId: number
  const itemIds: number[] = []

  const newItem = async (title: string) => {
    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie', 'test', $1, $2, '{}'::jsonb, $3) returning id`,
      [`remember-${Date.now()}-${Math.random()}`, title, Date.now()],
    )
    itemIds.push(item!.id)
    return item!.id
  }

  // A batch whose rows end up as given, then marked with `status`.
  const batchOf = async (
    user: number,
    status: string,
    rows: { title: string; year: number | null; state: string; reason: string | null; item: number | null }[],
  ) => {
    const batchId = await createBatch(
      db,
      user,
      'movie',
      'letterboxd',
      rows.map((row, i) => ({
        rowIndex: i + 2,
        title: row.title,
        year: row.year,
        rating: null,
        consumedAt: null,
      })),
    )
    const staged = await loadRows(db, batchId)
    for (const [i, row] of rows.entries()) {
      await recordMatch(db, staged[i]!.id, {
        state: row.state as 'confirmed',
        reason: row.reason,
        yearDelta: null,
        externalId: null,
        mediaItemId: row.item,
      })
    }
    await pool.query('update import_batches set status = $2 where id = $1', [batchId, status])
    return batchId
  }

  let littleWomen: number
  let crash: number
  let gone: number

  before(async () => {
    userId = await insertUser('import-remember')
    otherId = await insertUser('import-remember-other')
    littleWomen = await newItem('Little Women')
    crash = await newItem('Crash')
    gone = await newItem('Solaris')
    const heat = await newItem('Heat')

    await batchOf(userId, 'done', [
      { title: 'Little Women', year: null, state: 'confirmed', reason: 'no_year', item: littleWomen },
      { title: 'Solaris', year: null, state: 'confirmed', reason: 'no_year', item: gone },
      // A conflict taken, not a question asked.
      { title: 'Heat', year: 1995, state: 'confirmed', reason: 'exact', item: heat },
      { title: 'Skipped', year: null, state: 'skipped', reason: 'no_year', item: heat },
    ])
    await batchOf(userId, 'review', [
      { title: 'Crash', year: 2004, state: 'confirmed', reason: 'year_drift', item: crash },
    ])
    await batchOf(otherId, 'done', [
      { title: 'Crash', year: 2004, state: 'confirmed', reason: 'year_drift', item: crash },
    ])
    await pool.query('delete from media_items where id = $1', [gone])
  })

  after(async () => {
    await pool.query(
      'delete from import_rows where batch_id in (select id from import_batches where user_id = any($1))',
      [[userId, otherId]],
    )
    await pool.query('delete from import_batches where user_id = any($1)', [[userId, otherId]])
    await pool.query('delete from media_items where id = any($1)', [itemIds])
    await deleteUsers([userId, otherId])
  })

  it('keeps only answered questions from saved imports whose film still exists', async () => {
    const answers = await loadPastAnswers(db, userId, 'movie')
    assert.deepEqual([...answers.keys()], [answerKey('Little Women', null)])
    assert.equal(answers.get(answerKey('Little Women', null))?.media_item_id, littleWomen)
  })

  it('settles a new row the same way, in its section, and Change reopens it', async () => {
    const answers = await loadPastAnswers(db, userId, 'movie')
    const batchId = await createBatch(db, userId, 'movie', 'letterboxd', [
      { rowIndex: 2, title: 'little women', year: null, rating: 4, consumedAt: null },
    ])
    const [row] = await loadRows(db, batchId)
    await rememberRow(db, row!.id, answers.get(answerKey(row!.raw_title, null))!)
    await finishMatching(db, batchId)

    const batch = (await loadBatch(db, batchId, userId))!
    const { model } = await loadReview(db, batch)
    const [entry] = model.answered.no_year
    assert.equal(entry?.row.remembered, true)
    assert.equal(entry?.row.mediaItemId, littleWomen)
    assert.equal(model.last, null)

    await reopenRow(db, batch, row!.id)
    const [reopened] = await loadRows(db, batchId)
    assert.equal(reopened?.state, 'uncertain')
    assert.equal(reopened?.accepted_by, null)
  })
})
