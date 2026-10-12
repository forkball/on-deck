import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { hasImportedLibrary } from '../app/data/imports/batches.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// What the connections panel asks before telling somebody their history isn't
// here. Provenance, not size: the question is whether a library was ever
// brought across, and a log full of hand-logged films answers "no" to that as
// surely as an empty one does.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('has a library been imported', { skip: skipWithoutDatabase }, () => {
  let userId: number
  const stamp = Date.now()

  const batch = (id: string, mediaType: string, status: string) =>
    pool.query(
      `insert into import_batches (id, user_id, media_type, source, status, created_at, updated_at)
       values ($1, $2, $3, 'letterboxd', $4, $5, $5)`,
      [id, userId, mediaType, status, stamp],
    )

  before(async () => {
    userId = await insertUser('import-history')
  })

  after(async () => {
    await pool.query('delete from import_batches where user_id = $1', [userId])
    await deleteUsers([userId])
    await pool.end()
  })

  const clear = () => pool.query('delete from import_batches where user_id = $1', [userId])

  it('is false for someone who has never imported', async () => {
    await clear()

    assert.equal(await hasImportedLibrary(db, userId, 'movie'), false)
  })

  // The prompt would otherwise disappear the moment somebody started an import,
  // which is exactly when they have not finished one — a batch abandoned in
  // review wrote nothing to the log.
  it('is false while an import is still being reviewed', async () => {
    await clear()
    await batch(`b-matching-${stamp}`, 'movie', 'matching')
    await batch(`b-review-${stamp}`, 'movie', 'review')

    assert.equal(await hasImportedLibrary(db, userId, 'movie'), false)
  })

  it('is false for an import that failed', async () => {
    await clear()
    await batch(`b-failed-${stamp}`, 'movie', 'failed')

    assert.equal(await hasImportedLibrary(db, userId, 'movie'), false)
  })

  it('is true once a batch has been saved', async () => {
    await clear()
    await batch(`b-done-${stamp}`, 'movie', 'done')

    assert.equal(await hasImportedLibrary(db, userId, 'movie'), true)
  })

  // Books and games have their own importers and their own prompt, so a
  // finished Goodreads import must not answer for films.
  it('does not let one media type answer for another', async () => {
    await clear()
    await batch(`b-book-${stamp}`, 'book', 'done')

    assert.equal(await hasImportedLibrary(db, userId, 'movie'), false)
    assert.equal(await hasImportedLibrary(db, userId, 'book'), true)
  })
})
