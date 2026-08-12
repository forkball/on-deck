// Uses the v3 API key as a query param.

const TMDB_API_BASE = 'https://api.themoviedb.org/3'

// Static — rarely changes, and avoids an API round trip.
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

// Every genre this app knows about, for the recommendation filter's dropdown.
export const MOVIE_GENRES: string[] = Object.values(GENRE_ID_TO_NAME).sort()

// TV genres are numbered differently on TMDB, and the ids that do overlap with
// the movie list do so by coincidence — hence a separate table.
const TV_GENRE_ID_TO_NAME: Record<number, string> = {
  10759: 'action & adventure',
  16: 'animation',
  35: 'comedy',
  80: 'crime',
  99: 'documentary',
  18: 'drama',
  10751: 'family',
  10762: 'kids',
  9648: 'mystery',
  10763: 'news',
  10764: 'reality',
  10765: 'sci-fi & fantasy',
  10766: 'soap',
  10767: 'talk',
  10768: 'war & politics',
  37: 'western',
}

export const TV_GENRES: string[] = Object.values(TV_GENRE_ID_TO_NAME).sort()

export interface TmdbSearchResult {
  externalId: string
  title: string
  releaseYear: number | null
  tags: string[]
  posterUrl: string | null
  popularity: number
  overview: string | null
  // Only via getMovieById — TMDB's search endpoint omits runtime.
  runtimeMinutes: number | null
  // Non-film providers: each medium's length dimension and lead credit.
  pageCount?: number | null
  playtimeHours?: number | null
  // TV only — its length dimension. Runs the show, not an episode: number of
  // seasons is what "duration" means for something with no fixed runtime.
  seasonCount?: number | null
  creator?: string | null
  // Extra artwork beyond the poster, in display order. Games are the reason:
  // their 16:9 screenshots read well as a strip, and no other medium has any.
  images?: string[] | null
  // Games only.
  platforms?: string[] | null
  // Set only when a result's actual provenance differs from the provider
  // that produced it — currently just Google Books falling back to Open
  // Library on outage. searchAndImport uses this in place of the provider's
  // own sourceName when present, so a fallback hit isn't mistagged with an
  // id format that belongs to the primary provider instead.
  sourceOverride?: string
}

interface TmdbSearchResponse {
  results: {
    id: number
    title: string
    release_date: string
    genre_ids?: number[]
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
    // TMDB occasionally omits genre_ids on sparse/placeholder entries.
    tags: (r.genre_ids ?? []).map((id) => GENRE_ID_TO_NAME[id]).filter((t): t is string => Boolean(t)),
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null,
    popularity: r.popularity,
    overview: r.overview?.trim() || null,
    runtimeMinutes: null,
  }))
}

interface TmdbTvSearchResponse {
  results: {
    id: number
    name: string
    first_air_date: string
    genre_ids?: number[]
    poster_path: string | null
    popularity: number
    overview: string
  }[]
}

// Mirrors searchMovies; TV differs only in field names and genre ids.
export async function searchTv(query: string): Promise<TmdbSearchResult[]> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required')
  }

  const url = new URL(`${TMDB_API_BASE}/search/tv`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('query', query)
  url.searchParams.set('include_adult', 'false')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`TMDB TV search failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as TmdbTvSearchResponse

  return data.results.map((r) => ({
    externalId: String(r.id),
    title: r.name,
    releaseYear: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
    tags: (r.genre_ids ?? []).map((id) => TV_GENRE_ID_TO_NAME[id]).filter((t): t is string => Boolean(t)),
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null,
    popularity: r.popularity,
    overview: r.overview?.trim() || null,
    runtimeMinutes: null,
  }))
}

interface TmdbMovieDetailResponse {
  id: number
  title: string
  release_date: string
  genres: { id: number; name: string }[]
  poster_path: string | null
  popularity: number
  overview: string
  runtime: number | null
  // From append_to_response=credits, folded into the same request.
  credits?: { crew?: { job?: string; name?: string }[] }
}

// Used when autosuggest already resolved a pick, so selecting it doesn't need
// a second title search that could resolve to a different movie.
export async function getMovieById(externalId: string): Promise<TmdbSearchResult | null> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required')
  }

  const url = new URL(`${TMDB_API_BASE}/movie/${encodeURIComponent(externalId)}`)
  url.searchParams.set('api_key', apiKey)
  // The search endpoint has no director at all, hence by-id only.
  url.searchParams.set('append_to_response', 'credits')

  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`TMDB movie lookup failed: ${response.status} ${await response.text()}`)
  }

  const r = (await response.json()) as TmdbMovieDetailResponse

  return {
    externalId: String(r.id),
    title: r.title,
    releaseYear: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    tags: r.genres.map((g) => g.name.toLowerCase()),
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null,
    popularity: r.popularity,
    overview: r.overview?.trim() || null,
    runtimeMinutes: r.runtime ?? null,
    creator: r.credits?.crew?.find((member) => member.job === 'Director')?.name ?? null,
  }
}

interface TmdbTvDetailResponse {
  id: number
  name: string
  first_air_date: string
  genres: { id: number; name: string }[]
  poster_path: string | null
  popularity: number
  overview: string
  // Mostly empty on modern entries in favour of per-episode runtime, but still
  // present on older ones.
  episode_run_time: number[]
  last_episode_to_air: { runtime: number | null } | null
  created_by: { name?: string }[]
  number_of_seasons: number | null
}

// Mirrors getMovieById for TV shows.
export async function getTvShowById(externalId: string): Promise<TmdbSearchResult | null> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required')
  }

  const url = new URL(`${TMDB_API_BASE}/tv/${encodeURIComponent(externalId)}`)
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`TMDB TV lookup failed: ${response.status} ${await response.text()}`)
  }

  const r = (await response.json()) as TmdbTvDetailResponse

  return {
    externalId: String(r.id),
    title: r.name,
    releaseYear: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
    tags: r.genres.map((g) => g.name.toLowerCase()),
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null,
    popularity: r.popularity,
    overview: r.overview?.trim() || null,
    runtimeMinutes: r.episode_run_time[0] ?? r.last_episode_to_air?.runtime ?? null,
    seasonCount: r.number_of_seasons ?? null,
    creator: r.created_by?.[0]?.name ?? null,
  }
}

// Accepts a bare id or a full themoviedb.org URL, since pasting the URL is the
// natural thing to do. `segment` is 'movie' or 'tv' to match the right path.
export function parseTmdbId(input: string, segment: 'movie' | 'tv'): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  const match = trimmed.match(new RegExp(`themoviedb\\.org/${segment}/(\\d+)`))
  return match ? match[1] : null
}
