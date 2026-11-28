import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { createBatch, discardBatch, loadBatch, saveBatch } from '../app/data/imports/batches.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// saveBatch used to mark a batch saving in one statement and write the log row
// by row after it, outside a transaction. Two submits could both pass the
// controller's status check and save twice, and a save that threw part-way
// left the batch in `saving` for good — not listed, not discardable, never
// resumed. The claim, the writes and `done` now commit together or not at all.
describe('saving an import batch', { skip: skipWithoutDatabase }, () => {
  let userId: number
  const itemIds: number[] = []
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trigger = `import_save_test_${stamp.replace(/\W/g, '_')}`

  before(async () => {
    userId = (await insertUser('import-save')).id
    for (const title of ['Heat', 'Dune']) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into media_items (type, external_source, external_id, title, metadata, created_at)
         values ('movie', 'test', $1, $2, '{}'::jsonb, $3) returning id`,
        [`import-save-${stamp}-${title}`, title, Date.now()],
      )
      itemIds.push(rows[0]!.id)
    }
  })

  after(async () => {
    await pool.query(`drop trigger if exists ${trigger} on user_media_interactions`)
    await pool.query(`drop function if exists ${trigger}()`)
    await pool.query(
      'delete from import_rows where batch_id in (select id from import_batches where user_id = $1)',
      [userId],
    )
    await pool.query('delete from import_batches where user_id = $1', [userId])
    await deleteUsers([userId])
    await pool.query('delete from media_items where id = any($1)', [itemIds])
    await pool.end()
  })

  // A batch as the worker leaves it once matching is done, with both rows
  // confirmed against the two films.
  async function reviewableBatch() {
    const batchId = await createBatch(db, userId, 'movie', 'letterboxd', [
      { rowIndex: 2, title: 'Heat', year: 1995, rating: 4.5, consumedAt: null },
      { rowIndex: 3, title: 'Dune', year: 2021, rating: 3, consumedAt: null },
    ])
    await pool.query(
      `update import_rows r set state = 'confirmed', media_item_id = ($2::int[])[r.row_index - 1]
        where batch_id = $1`,
      [batchId, itemIds],
    )
    await pool.query("update import_batches set status = 'review' where id = $1", [batchId])
    const batch = await loadBatch(db, batchId, userId)
    assert.ok(batch)
    return batch
  }

  async function loggedCount(): Promise<number> {
    const { rows } = await pool.query<{ count: number }>(
      'select count(*)::int as count from user_media_interactions where user_id = $1',
      [userId],
    )
    return rows[0]!.count
  }

  it('rolls a save that fails part-way back to a batch still in review', async () => {
    const batch = await reviewableBatch()

    // The second film's write fails, after the first has already gone in.
    await pool.query(
      `create function ${trigger}() returns trigger language plpgsql as $$
       begin
         if new.media_item_id = ${itemIds[1]} and new.user_id = ${userId} then
           raise exception 'injected failure';
         end if;
         return new;
       end $$`,
    )
    await pool.query(
      `create trigger ${trigger} before insert or update on user_media_interactions
       for each row execute function ${trigger}()`,
    )
    try {
      // The adapter wraps the database's error; the trigger's is its cause.
      await assert.rejects(saveBatch(db, batch), (error: Error) =>
        /injected failure/.test(String((error.cause as Error | undefined)?.message)),
      )
    } finally {
      await pool.query(`drop trigger ${trigger} on user_media_interactions`)
      await pool.query(`drop function ${trigger}()`)
    }

    const after = await loadBatch(db, batch.id, userId)
    assert.equal(after?.status, 'review')
    assert.equal(after?.completed_at, null)
    // The first film's write went with the rest of the transaction.
    assert.equal(await loggedCount(), 0)

    assert.equal(await discardBatch(db, after), true)
    assert.equal(await loadBatch(db, batch.id, userId), null)
  })

  it('writes a batch once when two saves race for it', async () => {
    const batch = await reviewableBatch()

    // Both hold the batch as loaded in review, as two submits of the form would.
    const results = await Promise.all([saveBatch(db, batch), saveBatch(db, batch)])
    const won = results.filter((result) => result != null)
    assert.equal(won.length, 1, 'exactly one save writes')
    assert.deepEqual(won[0], { saved: 2, unchanged: 0, leftOut: 0 })

    const saved = await loadBatch(db, batch.id, userId)
    assert.equal(saved?.status, 'done')
    assert.equal(await loggedCount(), 2)

    // A save or discard holding the batch as it was before is turned away by
    // the statement itself, not just by a status check on a stale copy.
    assert.equal(await saveBatch(db, batch), null)
    assert.equal(await discardBatch(db, batch), false)
    assert.equal((await loadBatch(db, batch.id, userId))?.status, 'done')
  })
})
