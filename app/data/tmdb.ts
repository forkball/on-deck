// TMDB movie importer (plan section 2). Uses the v3 API key as a query param
// (the credential type most people get by default when they sign up).

const TMDB_API_BASE = 'https://api.themoviedb.org/3'

// Static TMDB movie genre list — rarely changes, avoids an extra API round trip.
const GENRE_ID_TO_NAME: Record<number, string> = {
  28: 'action',
  12: 'adventure',
  16: 'animation',
  35: 'comedy',
  80: 'crime',
  99: 'documentary',
  18: 'drama',
  10751: 'family',
  14: 'fantasy',
  36: 'history',
  27: 'horror',
  10402: 'music',
  9648: 'mystery',
  10749: 'romance',
  878: 'science fiction',
  10770: 'tv movie',
  53: 'thriller',
  10752: 'war',
  37: 'western',
}

export interface TmdbSearchResult {
  externalId: string
  title: string
  releaseYear: number | null
  tags: string[]
  posterUrl: string | null
  popularity: number
  overview: string | null
}

interface TmdbSearchResponse {
  results: {
    id: number
    title: string
    release_date: string
    genre_ids: number[]
    poster_path: string | null
    popularity: number
    overview: string
  }[]
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required')
  }

  const url = new URL(`${TMDB_API_BASE}/search/movie`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('query', query)
  url.searchParams.set('include_adult', 'false')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`TMDB search failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as TmdbSearchResponse

  return data.results.map((r) => ({
    externalId: String(r.id),
    title: r.title,
    releaseYear: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    tags: r.genre_ids.map((id) => GENRE_ID_TO_NAME[id]).filter((t): t is string => Boolean(t)),
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null,
    popularity: r.popularity,
    overview: r.overview?.trim() || null,
  }))
}
