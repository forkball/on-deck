import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { catalogPageFor } from '../app/data/catalog/links.ts'

function row(type: string, external_source: string, external_id: string, metadata: unknown = {}) {
  return { type, external_source, external_id, title: 'Elden Ring', metadata } as Parameters<
    typeof catalogPageFor
  >[0]
}

describe('catalogPageFor', () => {
  it('sends a TMDB row to the movie or TV page its type says it is', () => {
    assert.deepEqual(catalogPageFor(row('movie', 'tmdb', '603')), {
      name: 'TMDB',
      url: 'https://www.themoviedb.org/movie/603',
    })
    assert.deepEqual(catalogPageFor(row('tv', 'tmdb', '1396')), {
      name: 'TMDB',
      url: 'https://www.themoviedb.org/tv/1396',
    })
  })

  it('tells the two book catalogs apart by source, not by type', () => {
    assert.deepEqual(catalogPageFor(row('book', 'google-books', 'xIS9EAAAQBAJ')), {
      name: 'Google Books',
      url: 'https://books.google.com/books?id=xIS9EAAAQBAJ',
    })
    assert.deepEqual(catalogPageFor(row('book', 'openlibrary', 'OL45804W')), {
      name: 'Open Library',
      url: 'https://openlibrary.org/works/OL45804W',
    })
  })

  it('uses the stored IGDB page, and searches the title when a row predates it', () => {
    const url = 'https://www.igdb.com/games/elden-ring'
    assert.deepEqual(catalogPageFor(row('game', 'igdb', '119133', { sourceUrl: url })), { name: 'IGDB', url })
    assert.deepEqual(catalogPageFor(row('game', 'igdb', '119133')), {
      name: 'IGDB',
      url: 'https://www.igdb.com/search?type=1&q=Elden%20Ring',
    })
  })

  it('links nowhere for a source it does not know', () => {
    assert.equal(catalogPageFor(row('movie', 'letterboxd', 'x')), null)
  })
})
