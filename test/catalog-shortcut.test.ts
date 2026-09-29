import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { pool } from '../app/data/db.ts'
import { resolveFromCatalog } from '../app/data/recommendations/matching.ts'
import { skipWithoutDatabase } from './support/db.ts'

// resolveFromCatalog normalises titles twice: once in TypeScript for the pick, and
// once in SQL for the column, and the two have to agree exactly or the shortcut
// silently stops matching rows it holds. Nothing caught that pair drifting until
// this, and the ampersand rule was the first thing to move in one of them.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('local catalog shortcut', { skip: skipWithoutDatabase }, () => {
  const ids: number[] = []

  const insertBook = async (title: string) => {
    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('book','test',$1,$2,$3::jsonb,$4) returning id`,
      [
        `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        JSON.stringify({ releaseYear: 2015, overview: 'a plot the verifier can read' }),
        Date.now(),
      ],
    )
    ids.push(item.id)
  }

  before(async () => {
    await insertBook('Fire & Blood')
    await insertBook('Spider-Man: Blue')
  })

  after(async () => {
    await pool.query('delete from media_items where id = any($1)', [ids])
    await pool.end()
  })

  const pick = (title: string) => ({ title, year: 2015, reason: '' })

  it('matches a stored row spelled with an ampersand against a pick spelled with the word', async () => {
    const resolved = await resolveFromCatalog('book', [pick('Fire and Blood')])

    assert.equal(resolved.get(0)?.title, 'Fire & Blood')
  })

  it('still matches the row against its own spelling', async () => {
    const resolved = await resolveFromCatalog('book', [pick('Fire & Blood')])

    assert.equal(resolved.get(0)?.title, 'Fire & Blood')
  })

  // Punctuation is deleted, not spaced, so a hyphenated row matches the unhyphenated
  // spelling — and the database half has to agree about that too.
  it('matches a hyphenated stored title against an unhyphenated pick', async () => {
    const resolved = await resolveFromCatalog('book', [pick('Spiderman Blue')])

    assert.equal(resolved.get(0)?.title, 'Spider-Man: Blue')
  })

  it('does not match a different book', async () => {
    const resolved = await resolveFromCatalog('book', [pick('Blood & Fire')])

    assert.equal(resolved.get(0), undefined)
  })
})
