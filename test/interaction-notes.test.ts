import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { logInteraction, updateInteraction } from '../app/data/mediaItems.ts'
import { userMediaInteractions } from '../app/data/schema.ts'

// notes is three-state, like rating: undefined leaves whatever is stored, null
// clears it, a string sets it. This needs a database to be worth anything —
// the bug it pins was invisible in the types and only appeared in the SQL.
//
// What happened: user_media_interactions.notes was declared `c.text()` though
// the column has always been nullable, so writing null didn't typecheck and
// every caller reached for `?? undefined` instead. The upsert writes a key that
// is present-but-undefined as NULL, so that workaround cleared the note on any
// write that carried none — and Letterboxd and Steam never carry one. Taking a
// 834-row import erased every note in the log.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run (npm run db:up && npm run db:migrate)'

describe('interaction notes', { skip }, () => {
  let userId: number
  let itemId: number

  const noteNow = async () => {
    const [row] = await db.findMany(userMediaInteractions, {
      where: { user_id: userId, media_item_id: itemId },
      limit: 1,
    })
    return row?.notes ?? null
  }

  const interactionId = async () => {
    const [row] = await db.findMany(userMediaInteractions, {
      where: { user_id: userId, media_item_id: itemId },
      limit: 1,
    })
    return row.id
  }

  before(async () => {
    const stamp = Date.now()
    const {
      rows: [user],
    } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1, 'x', $2, $3) returning id`,
      [`notes-test-${stamp}@example.test`, `notes-test-${stamp}`, stamp],
    )
    userId = user.id

    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie', 'test', $1, 'Notes Fixture', '{}'::jsonb, $2) returning id`,
      [`notes-test-${stamp}`, stamp],
    )
    itemId = item.id
  })

  after(async () => {
    if (userId) {
      await pool.query('delete from user_media_interactions where user_id = $1', [userId])
      await pool.query('delete from users where id = $1', [userId])
    }
    if (itemId) await pool.query('delete from media_items where id = $1', [itemId])
    await pool.end()
  })

  it('writes a note when one is given', async () => {
    await logInteraction(db, userId, itemId, { status: 'consumed', notes: 'written by hand' })
    assert.equal(await noteNow(), 'written by hand')
  })

  // The regression. An import that carries no notes must not speak for the
  // column at all.
  it('leaves an existing note alone when none is given', async () => {
    await logInteraction(db, userId, itemId, { status: 'consumed', rating: 4 })
    assert.equal(await noteNow(), 'written by hand')
  })

  it('clears the note when null is given, which is someone emptying the field', async () => {
    await logInteraction(db, userId, itemId, { status: 'consumed', notes: null })
    assert.equal(await noteNow(), null)
  })

  it('holds the same three states on the edit path', async () => {
    await updateInteraction(db, await interactionId(), userId, { status: 'consumed', notes: 'edited' })
    assert.equal(await noteNow(), 'edited')

    await updateInteraction(db, await interactionId(), userId, { status: 'consumed' })
    assert.equal(await noteNow(), 'edited')

    await updateInteraction(db, await interactionId(), userId, { status: 'consumed', notes: null })
    assert.equal(await noteNow(), null)
  })
})
