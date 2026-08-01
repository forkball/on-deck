import type { Db } from './db.ts'
import { upsertMediaItem, rematchMediaItem, type MediaType, type RematchMediaItemResult } from './mediaCatalog.ts'
import type { MediaItem } from './schema.ts'
import { BOOK_GENRES, getBookById, parseOpenLibraryId, searchBooks } from './openLibrary.ts'
import {
  getMovieById,
  getTvShowById,
  parseTmdbId,
  searchMovies,
  searchTv,
  MOVIE_GENRES,
  TV_GENRES,
  type TmdbSearchResult,
} from './tmdb.ts'

// The provider-agnostic name for a catalog hit. Structurally this is already
// what TMDB returns — the alias exists so code written against the registry
// doesn't have to name a specific provider, and so a non-TMDB provider (Open
// Library for books) can satisfy the same contract.
export type CatalogSearchResult = TmdbSearchResult

// Everything that genuinely differs between one media type's catalog and
// another's. Anything NOT here is type-agnostic and already lives in
// mediaCatalog.ts.
export interface CatalogProvider {
  // Recorded as media_items.external_source, so ids from different providers
  // can never collide.
  sourceName: string
  search(query: string): Promise<CatalogSearchResult[]>
  getById(externalId: string): Promise<CatalogSearchResult | null>
  // Genre vocabulary offered by the recommendation filter for this type.
  genres: string[]
  // Turns whatever the "wrong match?" form accepts (a pasted URL or a bare
  // id) into an external id, or null if it isn't one. Providers whose items
  // have no public URL can just accept the bare id.
  parseExternalId(input: string): string | null
  // Shown when parseExternalId rejects the input.
  matchHint: string
  // Shown when the id parsed fine but the catalog had no such entry.
  lookupFailedError: string
}

// Keyed by MediaType. Note MediaType widens to `string` through the table row
// types, so this is deliberately a partial lookup — a type with no provider
// (games, and books/comics until their provider lands) resolves to undefined
// and callers are expected to fail loudly rather than silently substitute
// movies, which is what the old `=== 'tv' ? tv : movie` dispatch did.
const CATALOG_PROVIDERS: Record<string, CatalogProvider> = {
  movie: {
    sourceName: 'tmdb',
    search: searchMovies,
    getById: getMovieById,
    genres: MOVIE_GENRES,
    parseExternalId: (input) => parseTmdbId(input, 'movie'),
    matchHint: 'Paste a TMDB movie link or id.',
    lookupFailedError: "Couldn't find that on TMDB — check the link.",
  },
  book: {
    sourceName: 'openlibrary',
    search: searchBooks,
    getById: getBookById,
    genres: BOOK_GENRES,
    parseExternalId: parseOpenLibraryId,
    matchHint: 'Paste an Open Library link or work id.',
    lookupFailedError: "Couldn't find that on Open Library — check the link.",
  },
  tv: {
    sourceName: 'tmdb',
    search: searchTv,
    getById: getTvShowById,
    genres: TV_GENRES,
    parseExternalId: (input) => parseTmdbId(input, 'tv'),
    matchHint: 'Paste a TMDB show link or id.',
    lookupFailedError: "Couldn't find that on TMDB — check the link.",
  },
}

export function findCatalogProvider(type: MediaType): CatalogProvider | undefined {
  return CATALOG_PROVIDERS[type]
}

// For call sites that can't meaningfully continue without one — better to
// throw than to quietly recommend movies to someone who asked for books.
export function getCatalogProvider(type: MediaType): CatalogProvider {
  const provider = findCatalogProvider(type)
  if (!provider) throw new Error(`No catalog provider registered for media type "${type}".`)
  return provider
}

// Which types are actually searchable/loggable right now — drives the tabs
// and the recommendation source picker, so "coming soon" placeholders stay in
// one place instead of being hardcoded per component.
export function supportedMediaTypes(): MediaType[] {
  return Object.keys(CATALOG_PROVIDERS)
}

export interface CatalogItemResult {
  item: MediaItem
  tags: string[]
}

// Searches the provider for `type` and writes every hit into the catalog, so
// the results are real media_items the user can immediately log against.
// Repeating a search — which is exactly what pressing "back" from a result
// does — otherwise re-runs the catalog call and re-upserts every hit, for
// data that hasn't changed. Cached briefly so that round trip is free.
//
// Deliberately caches only the catalog half. The viewer's own interactions
// are fetched fresh on every render (see getUserInteractionsForItems), so
// logging something and going back still shows the updated status — caching
// those too is what would make this feel broken.
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 50

const searchCache = new Map<string, { storedAt: number; results: CatalogItemResult[] }>()

function cacheKey(type: MediaType, query: string): string {
  return `${type}:${query.trim().toLowerCase()}`
}

export async function searchAndImport(db: Db, type: MediaType, query: string): Promise<CatalogItemResult[]> {
  const key = cacheKey(type, query)
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.storedAt < SEARCH_CACHE_TTL_MS) {
    // Refresh insertion order so the eviction below is least-recently-used.
    searchCache.delete(key)
    searchCache.set(key, cached)
    return cached.results
  }

  const provider = getCatalogProvider(type)
  const results = await provider.search(query)

  // Concurrently, not in series. The catalog call itself is fast (~90ms for
  // TMDB); what made search feel slow was upserting ~20 results one after
  // another against a remote database, so the page waited on the sum of
  // every round-trip instead of the slowest one. Results keep their original
  // relevance order because Promise.all preserves input order.
  const imported = await Promise.all(
    results.map(async (result) => ({
      item: await upsertMediaItem(db, type, result, provider.sourceName),
      tags: result.tags,
    })),
  )

  searchCache.set(key, { storedAt: Date.now(), results: imported })
  if (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest touch.
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }

  return imported
}

export async function upsertCatalogItem(db: Db, type: MediaType, result: CatalogSearchResult): Promise<MediaItem> {
  return upsertMediaItem(db, type, result, getCatalogProvider(type).sourceName)
}

// Re-matches against the same provider the item came from.
export async function rematchCatalogItem(
  db: Db,
  type: MediaType,
  mediaItemId: number,
  externalId: string,
): Promise<RematchMediaItemResult> {
  const provider = getCatalogProvider(type)
  return rematchMediaItem(
    db,
    type,
    mediaItemId,
    externalId,
    provider.getById,
    provider.sourceName,
    provider.lookupFailedError,
  )
}
