import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'
import { searchBooks as searchOpenLibraryBooks } from './openLibrary.ts'

const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1'

// Categories come back as BISAC-style hierarchical strings ("Fiction /
// Science Fiction / General"), so genres are derived the same way Open
// Library's free-form subjects are: an entry matches if any needle appears
// anywhere in the category string.
const GENRE_MATCHERS: [genre: string, needles: string[]][] = [
  ['graphic novel', ['graphic novel', 'comic', 'manga']],
  ['science fiction', ['science fiction']],
  ['fantasy', ['fantasy']],
  ['mystery', ['mystery', 'detective']],
  ['thriller', ['thriller', 'suspense']],
  ['horror', ['horror']],
  ['romance', ['romance']],
  ['crime', ['crime']],
  ['historical', ['historical']],
  ['biography', ['biography', 'autobiograph']],
  ['young adult', ['young adult', 'juvenile']],
  ['adventure', ['adventure']],
  ['poetry', ['poetry']],
  ['philosophy', ['philosophy']],
  ['science', ['science', 'mathematics']],
  ['history', ['history']],
]

// The vocabulary offered by the recommendation genre filter.
export const BOOK_GENRES: string[] = GENRE_MATCHERS.map(([genre]) => genre).sort()

// The series filter's vocabulary — backed by volumeInfo.seriesInfo (see
// GoogleBooksVolume above), not a category/genre derivation.
export const BOOK_SERIES_TYPES: string[] = ['series', 'standalone']

const TAG_LIMIT = 4

function deriveGenres(categories: string[] | undefined): string[] {
  if (!categories || categories.length === 0) return []
  const lowered = categories.map((category) => category.toLowerCase())
  const matched: string[] = []
  for (const [genre, needles] of GENRE_MATCHERS) {
    if (lowered.some((category) => needles.some((needle) => category.includes(needle)))) {
      matched.push(genre)
      if (matched.length === TAG_LIMIT) break
    }
  }
  return matched
}

interface GoogleBooksVolume {
  id: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publishedDate?: string
    description?: string
    pageCount?: number
    categories?: string[]
    ratingsCount?: number
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    // Undocumented in the public reference but present in the API's own
    // discovery schema, and how "part of a series" is derived below — Google
    // Books has nothing else for it (no separate series/standalone flag).
    seriesInfo?: { volumeSeries?: unknown[] }
  }
}

interface GoogleBooksSearchResponse {
  items?: GoogleBooksVolume[]
}

// Image links come back as http:// even when the rest of the app is served
// over https, which browsers block as mixed content.
function toHttps(url: string | undefined): string | null {
  return url ? url.replace(/^http:\/\//, 'https://') : null
}

// Descriptions carry basic HTML (<b>, <i>, <br>) and entities, since they're
// lifted from the Play Books listing rather than plain text.
function cleanDescription(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function toResult(volume: GoogleBooksVolume): CatalogSearchResult {
  const info = volume.volumeInfo ?? {}
  const title = info.subtitle ? `${info.title}: ${info.subtitle}` : (info.title ?? 'Untitled')

  const seriesTag = (info.seriesInfo?.volumeSeries?.length ?? 0) > 0 ? 'series' : 'standalone'

  return {
    externalId: volume.id,
    title,
    releaseYear: info.publishedDate ? Number(info.publishedDate.slice(0, 4)) || null : null,
    tags: [...deriveGenres(info.categories), seriesTag],
    posterUrl: toHttps(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    popularity: info.ratingsCount ?? 0,
    overview: info.description ? cleanDescription(info.description) : null,
    runtimeMinutes: null,
    pageCount: info.pageCount ?? null,
    creator: info.authors?.[0] ?? null,
  }
}

function requireApiKey(): string {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY
  if (!apiKey) throw new Error('GOOGLE_BOOKS_API_KEY is required')
  return apiKey
}

// Measured live: a plain search returned a transient 503 backendFailed on the
// first try. Same shape as Open Library's fetchWithRetry, since the same kind
// of wobble turned out not to be an Open-Library-specific problem.
const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      // 5xx is worth another go; a 4xx means the request itself is wrong.
      if (response.ok || response.status < 500) return response
      lastError = new Error(`Google Books responded ${response.status}`)
    } catch (error) {
      lastError = error
    }

    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Google Books request failed')
}

const SEARCH_MAX_RESULTS = 20

async function searchGoogleBooksOnly(query: string): Promise<CatalogSearchResult[]> {
  const apiKey = requireApiKey()

  const url = new URL(`${GOOGLE_BOOKS_BASE}/volumes`)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(SEARCH_MAX_RESULTS))
  url.searchParams.set('key', apiKey)

  const response = await fetchWithRetry(url)
  if (!response.ok) {
    throw new Error(`Google Books search failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as GoogleBooksSearchResponse
  return (data.items ?? []).map(toResult)
}

// Search only — not getBookById, which a fallback can't help anyway: a
// Google-Books-shaped id means nothing to Open Library, so there's no id to
// hand it. Search has no such constraint, and it's the path an outage
// actually breaks for a user (typing into the search/autosuggest box), so
// this is where resilience earns its keep.
export async function searchBooks(query: string): Promise<CatalogSearchResult[]> {
  try {
    return await searchGoogleBooksOnly(query)
  } catch (error) {
    console.error('Google Books search failed, falling back to Open Library:', error)
    const fallback = await searchOpenLibraryBooks(query)
    return fallback.map((result) => ({ ...result, sourceOverride: 'openlibrary' }))
  }
}

export async function getBookById(externalId: string): Promise<CatalogSearchResult | null> {
  const apiKey = requireApiKey()
  const trimmed = externalId.trim()
  if (!trimmed) return null

  const url = new URL(`${GOOGLE_BOOKS_BASE}/volumes/${encodeURIComponent(trimmed)}`)
  url.searchParams.set('key', apiKey)

  const response = await fetchWithRetry(url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Google Books lookup failed: ${response.status} ${await response.text()}`)
  }

  const volume = (await response.json()) as GoogleBooksVolume
  return toResult(volume)
}

// Volume ids are opaque ~12-character tokens (e.g. "-Ff2DwAAQBAJ"), shown in
// both books.google.com and play.google.com URLs as ?id=. Bare-id matching is
// narrower than Open Library's or TMDB's since there's no fixed prefix to
// anchor on, so it's restricted to the observed id shape.
const BARE_ID = /^[A-Za-z0-9_-]{10,15}$/

export function parseGoogleBooksId(input: string): string | null {
  const trimmed = input.trim()
  if (BARE_ID.test(trimmed)) return trimmed

  const match = trimmed.match(/[?&]id=([A-Za-z0-9_-]{6,})/)
  return match ? match[1] : null
}
