import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { getMovieById } from '../app/data/catalog/tmdb.ts'
import { parseMediaMetadata } from '../app/data/mediaMetadata.ts'

// The shape TMDB answers /movie/:id?append_to_response=credits with, cut down to
// what the lookup reads.
const MATRIX = {
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-30',
  genres: [{ id: 28, name: 'Action' }],
  poster_path: null,
  popularity: 80,
  overview: 'A hacker learns the truth.',
  runtime: 136,
  tagline: ' Welcome to the Real World. ',
  credits: {
    cast: [
      { name: 'Keanu Reeves', character: 'Neo' },
      { name: 'Laurence Fishburne', character: 'Morpheus' },
      { name: 'Carrie-Anne Moss', character: 'Trinity' },
      { name: 'Hugo Weaving', character: 'Agent Smith' },
      { name: 'Gloria Foster', character: '' },
      { name: 'Joe Pantoliano', character: 'Cypher' },
    ],
    crew: [
      { job: 'Director', name: 'Lana Wachowski' },
      { job: 'Writer', name: 'Lana Wachowski' },
      { job: 'Director', name: 'Lilly Wachowski' },
    ],
  },
}

describe('getMovieById', () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.TMDB_API_KEY

  beforeEach(() => {
    process.env.TMDB_API_KEY = 'test'
    globalThis.fetch = (async () => Response.json(MATRIX)) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = realKey
  })

  it('credits every director, not only the first', async () => {
    const result = await getMovieById('603')
    assert.deepEqual(result?.creators, ['Lana Wachowski', 'Lilly Wachowski'])
    assert.equal(result?.creator, 'Lana Wachowski, Lilly Wachowski')
  })

  it('keeps the top-billed cast in order, and a blank character as none', async () => {
    const result = await getMovieById('603')
    assert.deepEqual(result?.cast, [
      { name: 'Keanu Reeves', character: 'Neo' },
      { name: 'Laurence Fishburne', character: 'Morpheus' },
      { name: 'Carrie-Anne Moss', character: 'Trinity' },
      { name: 'Hugo Weaving', character: 'Agent Smith' },
      { name: 'Gloria Foster', character: null },
    ])
  })

  it('trims the tagline', async () => {
    assert.equal((await getMovieById('603'))?.tagline, 'Welcome to the Real World.')
  })
})

describe('parseMediaMetadata cast', () => {
  it('drops entries without a name rather than rendering a blank row', () => {
    const { cast } = parseMediaMetadata({
      cast: [{ name: 'Keanu Reeves', character: 'Neo' }, { character: 'x' }, 7],
    })
    assert.deepEqual(cast, [{ name: 'Keanu Reeves', character: 'Neo' }])
  })

  it('reads a row stored before cast existed as having none', () => {
    const { cast, creators, tagline } = parseMediaMetadata({ creator: 'Someone' })
    assert.deepEqual(cast, [])
    assert.deepEqual(creators, [])
    assert.equal(tagline, null)
  })
})
