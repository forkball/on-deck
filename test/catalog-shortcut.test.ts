import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { pool } from '../app/data/db.ts'
import { resolveFromCatalog } from '../app/data/recommendations/matching.ts'
import { skipWithoutDatabase } from './support/db.ts'

// The shortcut that keeps a run from asking a provider about something we already
// hold. Three rules decide whether a stored row answers a pick, and each has cost a
// run something:
//
//  - the row has to come from the provider we would otherwise ask, or a book run
//    answers itself with whatever Open Library knew;
//  - the title comparison happens in TypeScript, so it is the same rule the rest of
//    matching uses rather than a second spelling of it in SQL;
//  - identity is the author for a book and the year for everything else, because a
//    book's stored year is the year of a printing.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('local catalog shortcut', { skip: skipWithoutDatabase }, () => {
  const ids: number[] = []

  // Titles carry it too, not just external ids: this runs against a development
  // database that holds real catalog rows, and a fixture named after a real book is
  // answered by that book rather than by itself.
  const stamp = `zz${Date.now().toString(36)}`

  const insert = async (
    type: 'book' | 'movie',
    source: string,
    title: string,
    metadata: Record<string, unknown>,
  ) => {
    const {
      rows: [item],
    } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ($1,$2,$3,$4,$5::jsonb,$6) returning id`,
      [
        type,
        source,
        `shortcut-${stamp}-${ids.length}`,
        `${title} ${stamp}`,
        JSON.stringify({ overview: 'a plot the verifier can read', ...metadata }),
        Date.now(),
      ],
    )
    ids.push(item.id)
    return item.id
  }

  before(async () => {
    // A book we hold as a 2007 printing of a 1973 work — the case that missed.
    await insert('book', 'google-books', 'The Denial of Death', {
      releaseYear: 2007,
      creator: 'Ernest Becker',
    })
    await insert('book', 'google-books', 'Fire & Blood', {
      releaseYear: 2018,
      creator: 'George R. R. Martin',
    })
    await insert('book', 'google-books', 'The Night Circus', {
      releaseYear: 2011,
      creator: 'Erin Morgenstern',
    })
    await insert('book', 'google-books', 'Nobody Signed It', { releaseYear: 1999 })
    // The same book, from the provider the app has moved off.
    await insert('book', 'openlibrary', 'Piranesi', { releaseYear: 2020, creator: 'Susanna Clarke' })
    await insert('movie', 'tmdb', 'Dune', { releaseYear: 2021 })
  })

  after(async () => {
    await pool.query('delete from media_items where id = any($1)', [ids])
    await pool.end()
  })

  const resolve = (type: 'book' | 'movie', title: string, year: number, creator?: string) =>
    resolveFromCatalog(type, [{ title: `${title} ${stamp}`, year, reason: '', creator }])

  it('answers a book on its author, whatever printing we happen to hold', async () => {
    const resolved = await resolve('book', 'The Denial of Death', 1973, 'Ernest Becker')

    assert.match(resolved.get(0)?.title ?? '', /^The Denial of Death/)
  })

  it('refuses a different book with the same title', async () => {
    const resolved = await resolve('book', 'The Denial of Death', 1973, 'Someone Else')

    assert.equal(resolved.get(0), undefined)
  })

  // Initials are spaced differently by every catalog and every model.
  it('reads a name past its punctuation and spacing', async () => {
    const resolved = await resolve('book', 'Fire and Blood', 2018, 'George R.R. Martin')

    assert.match(resolved.get(0)?.title ?? '', /^Fire & Blood/)
  })

  // The title rule is the matcher's own now, not string equality in a query.
  it('answers a pick spelled without the stored subtitle', async () => {
    const resolved = await resolveFromCatalog('book', [
      { title: `The Night Circus ${stamp}`, year: 2011, reason: '', creator: 'Erin Morgenstern' },
    ])

    assert.match(resolved.get(0)?.title ?? '', /^The Night Circus/)
  })

  it('ignores a row from a provider the app no longer asks', async () => {
    const resolved = await resolve('book', 'Piranesi', 2020, 'Susanna Clarke')

    assert.equal(resolved.get(0), undefined)
  })

  it('falls back to the year when nobody says who wrote it', async () => {
    const near = await resolve('book', 'Nobody Signed It', 1999)
    const far = await resolve('book', 'Nobody Signed It', 1950)

    assert.match(near.get(0)?.title ?? '', /^Nobody Signed It/)
    assert.equal(far.get(0), undefined)
  })

  it('still answers a film on its year, which is the film', async () => {
    const found = await resolve('movie', 'Dune', 2021)
    const remake = await resolve('movie', 'Dune', 1984)

    assert.match(found.get(0)?.title ?? '', /^Dune/)
    assert.equal(remake.get(0), undefined)
  })
})
