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

// Sorted list of every genre this app knows about — used to build the
// recommendation genre filter's dropdown without a second API round trip.
export const MOVIE_GENRES: string[] = Object.values(GENRE_ID_TO_NAME).sort()

// TV has its own, differently-numbered genre list on TMDB (e.g. "Action &
// Adventure" and "Sci-Fi & Fantasy" don't exist for movies; "Documentary"
// and "Western" share ids with the movie list by coincidence, not by design
// — so this is kept as its own table rather than merged with the movie one).
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
  // Only ever populated via getMovieById — TMDB's search endpoint doesn't
  // return runtime, only the per-movie detail endpoint does.
  runtimeMinutes: number | null
  // Populated by non-film providers — each medium's own length dimension,
  // plus the credit that stands in for a director.
  pageCount?: number | null
  playtimeHours?: number | null
  creator?: string | null
  // Extra artwork beyond the poster, widest-first in the medium's natural
  // shape. Games are the reason this exists: RAWG has no box art, only
  // 16:9 stills, which look wrong squeezed into a poster slot but read
  // well as a carousel.
  images?: string[] | null
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

// Mirrors searchMovies — TMDB's TV search shape differs only in field names
// (name/first_air_date instead of title/release_date) and its own genre ids.
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
  // Present because of append_to_response=credits below — folded into the
  // same request rather than costing a second round trip.
  credits?: { crew?: { job?: string; name?: string }[] }
}

// Looks a movie up by its known TMDB id — used when the autosuggest dropdown
// already resolved a pick, so selecting it doesn't need a second title
// search (which could in principle even resolve to a different movie).
export async function getMovieById(externalId: string): Promise<TmdbSearchResult | null> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required')
  }

  const url = new URL(`${TMDB_API_BASE}/movie/${encodeURIComponent(externalId)}`)
  url.searchParams.set('api_key', apiKey)
  // Credits ride along on the same request; the search endpoint has no
  // director at all, which is why this only appears on a by-id lookup.
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
  // TMDB has largely stopped populating this (empty array on most modern
  // entries) in favor of per-episode runtime — kept as the first fallback
  // since it's still present on some older/legacy entries.
  episode_run_time: number[]
  last_episode_to_air: { runtime: number | null } | null
  created_by: { name?: string }[]
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
    creator: r.created_by?.[0]?.name ?? null,
  }
}

// Accepts a bare TMDB id or a full URL like themoviedb.org/movie/27205-inception
// (or /tv/1396-breaking-bad) — used by the "wrong movie/show? fix it" form on
// detail pages, where pasting the URL straight from TMDB's site is the
// natural thing to do. `segment` is 'movie' or 'tv' to match the right path.
export function parseTmdbId(input: string, segment: 'movie' | 'tv'): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  const match = trimmed.match(new RegExp(`themoviedb\\.org/${segment}/(\\d+)`))
  return match ? match[1] : null
}
