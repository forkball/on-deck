import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { logInteraction } from '../app/data/mediaItems.ts'
import { INTERACTION_SOURCES, userMediaInteractions } from '../app/data/schema.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// `source` is what the Letterboxd sync consults before removing anything, so
// the rule it encodes is load-bearing: a row belongs to whoever created it, and
// no later writer inherits it.
//
// This needs a database for the same reason interaction-notes.test.ts does. The
// rule is enforced by which keys reach the upsert's `update` clause, not by the
// types — the compiler is equally happy with a version that overwrites `source`
// on every conflict, and the difference only shows up in the SQL.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('interaction provenance', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let itemId: number

  const stored = async () => {
    const [row] = await db.findMany(userMediaInteractions, {
      where: { user_id: userId, media_item_id: itemId },
      limit: 1,
    })
    return { source: row?.source ?? null, entryAt: row?.source_entry_at ?? null }
  }

  const clear = () => pool.query('delete from user_media_interactions where user_id = $1', [userId])

  before(async () => {
    userId = await insertUser('source-test')

    const stamp = Date.now()
    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie', 'test', $1, 'Provenance Fixture', '{}'::jsonb, $2) returning id`,
      [`source-test-${stamp}`, stamp],
    )
    itemId = item!.id
  })

  after(async () => {
    await deleteUsers([userId])
    if (itemId) await pool.query('delete from media_items where id = $1', [itemId])
    await pool.end()
  })

  it('records the source that created the row', async () => {
    await clear()
    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      source: INTERACTION_SOURCES.letterboxdFeed,
    })

    assert.equal((await stored()).source, 'letterboxd-feed')
  })

  // The one that matters. A member adds a film by hand, then watches it and
  // logs it on Letterboxd; the sync flips the row to consumed. If that write
  // took the row over, deleting the diary entry later would destroy something
  // the member created here.
  it('leaves a hand-written row owned by the person who wrote it', async () => {
    await clear()
    await logInteraction(db, userId, itemId, {
      status: 'want_to_consume',
      source: INTERACTION_SOURCES.manual,
    })

    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      rating: 4,
      source: INTERACTION_SOURCES.letterboxdFeed,
      sourceEntryAt: 5_000,
    })

    const row = await stored()
    assert.equal(row.source, 'manual', 'the sync must not take ownership of a row it did not create')
    // The rest of the write still lands — this is about ownership, not about
    // refusing the update.
    const [stored_] = await db.findMany(userMediaInteractions, {
      where: { user_id: userId, media_item_id: itemId },
      limit: 1,
    })
    assert.equal(stored_!.status, 'consumed')
    assert.equal(Number(stored_!.rating), 4)
  })

  it('does not let an importer claim a row the feed created either', async () => {
    await clear()
    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      source: INTERACTION_SOURCES.letterboxdFeed,
    })
    await logInteraction(db, userId, itemId, { status: 'consumed', source: 'letterboxd' })

    assert.equal((await stored()).source, 'letterboxd-feed')
  })

  it('leaves source null on a row written by a caller that names none', async () => {
    await clear()
    await logInteraction(db, userId, itemId, { status: 'consumed' })

    // Null is what the delete pass refuses to act on, so this is the safe
    // default rather than an oversight.
    assert.equal((await stored()).source, null)
  })

  // Unlike source, this one does move: it tracks the newest entry holding the
  // film inside the feed's window, so a rewatch has to be able to advance it.
  it('advances the entry date on a later sync', async () => {
    await clear()
    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      source: INTERACTION_SOURCES.letterboxdFeed,
      sourceEntryAt: 1_000,
    })
    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      source: INTERACTION_SOURCES.letterboxdFeed,
      sourceEntryAt: 9_000,
    })

    assert.equal((await stored()).entryAt, 9_000)
  })

  // The bug interaction-notes.test.ts was written for, in a new column: a key
  // that is present but undefined is written as NULL, so a writer with no entry
  // date to give would blank the one already stored and drop the row out of the
  // window it belongs in.
  it('leaves the entry date alone when a write carries none', async () => {
    await clear()
    await logInteraction(db, userId, itemId, {
      status: 'consumed',
      source: INTERACTION_SOURCES.letterboxdFeed,
      sourceEntryAt: 7_000,
    })
    await logInteraction(db, userId, itemId, { status: 'consumed', rating: 3 })

    assert.equal((await stored()).entryAt, 7_000)
  })
})
