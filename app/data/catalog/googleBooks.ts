import { createProviderCircuit } from './circuit.ts'
import { fetchWithRetry } from './retry.ts'
import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'
import { searchBooks as searchOpenLibraryBooks } from './openLibrary.ts'

const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1'

// Categories come back as BISAC-style hierarchical strings ("Fiction /
// Science Fiction / General"), so genres are derived the same way Open
// Library's free-form subjects are: an entry matches if any needle appears
// anywhere in the category string.
//
// On the by-id record only, though. A search hit carries the top level and
// nothing under it — "Fiction" for Dune, which matches no needle below — so a
// hit with no genre tag says nothing about the book. filterByGenre in
// matching.ts is what pays for the difference, and only when the lever is set.
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

export const BOOK_GENRES: string[] = GENRE_MATCHERS.map(([genre]) => genre).sort()

// Asked of the model in the pick prompt and left at that: volumeInfo.seriesInfo
// is in the API's own discovery schema but is no longer returned for any volume,
// by search or by id. A tag derived from its absence called every book in the
// catalog standalone, Dune included, so the tags below carry no series entry and
// nothing here re-checks the model's answer.
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

  return {
    externalId: volume.id,
    title,
    releaseYear: info.publishedDate ? Number(info.publishedDate.slice(0, 4)) || null : null,
    tags: deriveGenres(info.categories),
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

// Three failures in a row is a provider that is down, not three bad queries.
// Deliberately per-provider rather than on the registry: this one is cheap
// because searchBooks has a free fallback, and IGDB's revoked-token throw is
// meant to be recovered by the very next call.
const circuit = createProviderCircuit('Google Books', 3, 60_000)

const SEARCH_MAX_RESULTS = 20

// Exported for the backfill, which must never accept an Open Library answer:
// its whole job is moving rows off Open Library, so a fallback hit there is a
// row "upgraded" to where it already was.
//
// It also keeps the backfill out of the circuit below. That circuit is a module
// singleton shared with the live app, so a long run failing its way through
// hundreds of rows would open it and push real searches to the fallback while
// it worked.
export async function searchGoogleBooksOnly(query: string): Promise<CatalogSearchResult[]> {
  const apiKey = requireApiKey()

  const url = new URL(`${GOOGLE_BOOKS_BASE}/volumes`)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(SEARCH_MAX_RESULTS))
  url.searchParams.set('key', apiKey)

  const response = await fetchWithRetry(url, 'Google Books')
  if (!response.ok) {
    throw new Error(`Google Books search failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as GoogleBooksSearchResponse
  return (data.items ?? []).map(toResult)
}

export async function searchBooks(query: string): Promise<CatalogSearchResult[]> {
  // Skipped rather than tried once per pick: the rest of a run's fan-out would
  // each pay three attempts and a second of sleeping for the same answer.
  if (!circuit.isOpen()) {
    try {
      return await circuit.run(() => searchGoogleBooksOnly(query))
    } catch (error) {
      console.error('Google Books search failed, falling back to Open Library:', error)
    }
  }

  const fallback = await searchOpenLibraryBooks(query)
  return fallback.map((result) => ({ ...result, sourceOverride: 'openlibrary' }))
}

export async function getBookById(externalId: string): Promise<CatalogSearchResult | null> {
  const apiKey = requireApiKey()
  const trimmed = externalId.trim()
  if (!trimmed) return null

  // No fallback here, unlike search, so an open circuit gives up rather than
  // spending three more attempts on a service already known to be down.
  if (circuit.isOpen()) throw new Error('Google Books is not answering — lookup skipped')

  // A 404 returns rather than throws, so answering "no" never counts as down.
  return circuit.run(async () => {
    const url = new URL(`${GOOGLE_BOOKS_BASE}/volumes/${encodeURIComponent(trimmed)}`)
    url.searchParams.set('key', apiKey)

    const response = await fetchWithRetry(url, 'Google Books')
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Google Books lookup failed: ${response.status} ${await response.text()}`)
    }

    const volume = (await response.json()) as GoogleBooksVolume
    return toResult(volume)
  })
}

// Volume ids are opaque ~12-character tokens (e.g. "-Ff2DwAAQBAJ"), shown in
// both books.google.com and play.google.com URLs as ?id=. Bare-id matching is
// narrower than Open Library's or TMDB's since there's no fixed prefix to
// anchor on, so it's restricted to the observed id shape.
const BARE_ID = /^[A-Za-z0-9_-]{10,15}$/

// What Google serves today: the id is the last path segment, after a slug of the
// title, and there is no `id=` anywhere in it —
// google.ca/books/edition/Iron_Flame/xIS9EAAAQBAJ. Anyone copying a link out of
// the address bar in 2026 gets this form, and only this form; the `?id=` shape
// below is what books.google.com and play.google.com still emit. Both are
// accepted, since old links keep working and pasted links come from everywhere.
//
// The slug is skipped rather than matched: it is the title, so it carries
// apostrophes, accents and non-Latin scripts, and `_` when Google omits it.
const EDITION_PATH = /\/books\/edition\/[^/]*\/([A-Za-z0-9_-]{10,15})/

export function parseGoogleBooksId(input: string): string | null {
  const trimmed = input.trim()
  if (BARE_ID.test(trimmed)) return trimmed

  const path = trimmed.match(EDITION_PATH)
  if (path) return path[1]

  const match = trimmed.match(/[?&]id=([A-Za-z0-9_-]{6,})/)
  return match ? match[1] : null
}
