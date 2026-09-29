import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getCatalogProvider } from '../app/data/catalog/provider.ts'
import { MOVIE_GENRES, TV_GENRES } from '../app/data/catalog/tmdb.ts'
import { GAME_GENRES } from '../app/data/catalog/igdb.ts'
import { BOOK_GENRES } from '../app/data/catalog/googleBooks.ts'

// A genre in the dropdown is compared, as a string, against what the provider puts in
// a result's tags. A value the catalog never produces is a filter that can only answer
// nothing — and it answers nothing quietly, which is how "hack and slash/beat em up"
// survived: IGDB spells it with an apostrophe, so choosing it kept 0 of 3 games that
// carry the genre.
//
// Checking the vocabularies against the live APIs needs keys and the network, so the
// standing guarantee here is the cheaper one: every offered value is the shape the
// comparison requires, and the lists the form reads are the lists the providers own.
describe('genre vocabularies', () => {
  const offered = {
    movie: MOVIE_GENRES,
    tv: TV_GENRES,
    game: GAME_GENRES,
    book: BOOK_GENRES,
  } as const

  for (const [type, list] of Object.entries(offered)) {
    it(`${type}: the form reads the provider's own list`, () => {
      assert.deepEqual(getCatalogProvider(type as keyof typeof offered).genres, list)
    })

    // Tags are lowercased on the way out of every provider (`genre.name.toLowerCase()`
    // and the BISAC needles), so an offered value with an uppercase letter can never
    // match one.
    it(`${type}: every offered value is lowercase and trimmed`, () => {
      for (const genre of list) {
        assert.equal(genre, genre.toLowerCase(), `${genre} is not lowercase`)
        assert.equal(genre, genre.trim(), `${genre} has surrounding space`)
        assert.ok(genre.length > 0)
      }
    })

    it(`${type}: offers no duplicates`, () => {
      assert.equal(new Set(list).size, list.length)
    })
  }

  // The specific value that was wrong, spelled as IGDB spells it. Worth its own case:
  // the apostrophe is the whole bug, and a reader deleting it would not otherwise see
  // a test fail.
  it('spells the IGDB genre with the apostrophe IGDB uses', () => {
    assert.ok(GAME_GENRES.includes("hack and slash/beat 'em up"))
    assert.ok(!GAME_GENRES.includes('hack and slash/beat em up'))
  })
})
