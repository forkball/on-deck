import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { getMovieById, getTvShowById, getWatchProviders } from '../app/data/catalog/tmdb.ts'
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

// /tv/:id?append_to_response=aggregate_credits, cut down the same way.
const BREAKING_BAD = {
  id: 1396,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  last_air_date: '2013-09-29',
  status: 'Ended',
  genres: [{ id: 18, name: 'Drama' }],
  poster_path: null,
  popularity: 400,
  overview: 'A chemistry teacher turns to crime.',
  episode_run_time: [],
  last_episode_to_air: { runtime: 55 },
  created_by: [{ name: 'Vince Gilligan' }],
  number_of_seasons: 5,
  number_of_episodes: 62,
  tagline: '',
  networks: [{ name: 'AMC' }],
  aggregate_credits: {
    cast: [
      // Listed first but in fewer episodes — TMDB's order is not the one to show.
      { name: 'Guest Star', total_episode_count: 3, roles: [{ character: 'Somebody', episode_count: 3 }] },
      {
        name: 'Bryan Cranston',
        total_episode_count: 62,
        roles: [{ character: 'Walter White', episode_count: 62 }],
      },
      {
        name: 'Aaron Paul',
        total_episode_count: 62,
        roles: [
          { character: 'Jesse Pinkman (voice)', episode_count: 1 },
          { character: 'Jesse Pinkman', episode_count: 62 },
        ],
      },
      { total_episode_count: 99, roles: [] },
    ],
  },
}

describe('getTvShowById', () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.TMDB_API_KEY
  let requested: URL | null = null

  beforeEach(() => {
    process.env.TMDB_API_KEY = 'test'
    globalThis.fetch = (async (input: URL) => {
      requested = input
      return Response.json(BREAKING_BAD)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = realKey
  })

  it("asks for the whole run's cast, not the latest season's", async () => {
    await getTvShowById('1396')
    assert.equal(requested?.searchParams.get('append_to_response'), 'aggregate_credits')
  })

  it('orders the cast by episodes, crediting each actor with their main part', async () => {
    const result = await getTvShowById('1396')
    assert.deepEqual(result?.cast, [
      { name: 'Bryan Cranston', character: 'Walter White' },
      { name: 'Aaron Paul', character: 'Jesse Pinkman' },
      { name: 'Guest Star', character: 'Somebody' },
    ])
  })

  it('keeps the shape of the run', async () => {
    const result = await getTvShowById('1396')
    assert.equal(result?.releaseYear, 2008)
    assert.equal(result?.lastAirYear, 2013)
    assert.equal(result?.showStatus, 'Ended')
    assert.equal(result?.seasonCount, 5)
    assert.equal(result?.episodeCount, 62)
    assert.deepEqual(result?.networks, ['AMC'])
    assert.equal(result?.tagline, null)
  })

  it('credits every creator', async () => {
    const result = await getTvShowById('1396')
    assert.deepEqual(result?.creators, ['Vince Gilligan'])
    assert.equal(result?.creator, 'Vince Gilligan')
  })
})

describe('getWatchProviders', () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.TMDB_API_KEY
  let requested: URL | null = null
  let answer: Response = Response.json({})

  beforeEach(() => {
    process.env.TMDB_API_KEY = 'test'
    globalThis.fetch = (async (input: URL) => {
      requested = input
      return answer
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = realKey
  })

  it("keeps each country's included services in TMDB's order, and leaves rent and buy out", async () => {
    answer = Response.json({
      results: {
        CA: {
          link: 'https://www.themoviedb.org/tv/1396-breaking-bad/watch?locale=CA',
          flatrate: [
            { provider_name: 'Crave', logo_path: '/crave.jpg', display_priority: 5 },
            { provider_name: 'Netflix', logo_path: '/netflix.jpg', display_priority: 1 },
          ],
          ads: [{ provider_name: 'Pluto TV', logo_path: null, display_priority: 9 }],
          buy: [{ provider_name: 'Apple TV', logo_path: '/apple.jpg', display_priority: 2 }],
        },
      },
    })

    const regions = await getWatchProviders('tv', '1396')
    assert.equal(requested?.pathname, '/3/tv/1396/watch/providers')
    assert.deepEqual(regions, {
      CA: {
        stream: [
          { name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/netflix.jpg' },
          { name: 'Crave', logoUrl: 'https://image.tmdb.org/t/p/w92/crave.jpg' },
        ],
        free: [],
        ads: [{ name: 'Pluto TV', logoUrl: null }],
      },
    })
  })

  it('answers null for a title TMDB does not know, and throws on any other failure', async () => {
    answer = new Response('', { status: 404 })
    assert.equal(await getWatchProviders('movie', '0'), null)

    answer = new Response('down', { status: 503 })
    await assert.rejects(() => getWatchProviders('movie', '603'))
  })
})
