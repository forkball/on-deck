import type { Db } from '../db.ts'
import {
  markMediaItemEnriched,
  upsertMediaItem,
  rematchMediaItem,
  type MediaType,
  type RematchMediaItemResult,
} from '../mediaItems.ts'
import type { MediaItem } from '../schema.ts'
import { BOOK_GENRES, BOOK_SERIES_TYPES, getBookById, parseGoogleBooksId, searchBooks } from './googleBooks.ts'
import {
  GAME_GENRES,
  GAME_MULTIPLAYER_TYPES,
  GAME_PLATFORMS,
  GAME_PLAYER_TYPES,
  getGameById,
  parseIgdbId,
  searchGames,
} from './igdb.ts'
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

// Structurally what TMDB returns, aliased so other providers satisfy one shape.
export type CatalogSearchResult = TmdbSearchResult

// In whatever unit a provider measures. `very_long` is emitted only by providers
// with a 4th tier (currently movies).
export type LengthBucket = 'short' | 'medium' | 'long' | 'very_long'

// Everything that differs per media type. Anything not here is type-agnostic and
// lives in mediaItems.ts.
export interface CatalogProvider {
  // Recorded as media_items.external_source, so ids from different providers
  // can't collide.
  sourceName: string
  search(query: string): Promise<CatalogSearchResult[]>
  getById(externalId: string): Promise<CatalogSearchResult | null>
  genres: string[]
  playerTypes?: string[]
  multiplayerTypes?: string[]
  // Platform *families*, not raw names — see GAME_PLATFORMS.
  platforms?: string[]
  seriesTypes?: string[]
  parseExternalId(input: string): string | null
  matchHint: string
  lookupFailedError: string
  // On the provider because one global check can only be right for one medium.
  matchesLength(result: CatalogSearchResult, length: LengthBucket): boolean
  // A provider's own list is what `length` may validly be — omitted buckets are
  // ones it has no meaning for.
  //
  // `label` is for the form, `phrase` for the pick prompt, on one entry so a
  // bucket can't reach one and not the other.
  lengthOptions: { value: LengthBucket; label: string; phrase: string }[]
}

// Fits after "Only suggest books with …". Null when the medium doesn't offer the
// bucket, in which case there is nothing truthful to ask for.
export function describeLength(provider: CatalogProvider, length: LengthBucket): string | null {
  return provider.lengthOptions.find((option) => option.value === length)?.phrase ?? null
}

// Keyed by MediaType, which widens to `string` through the row types, so this is
// deliberately partial — see getCatalogProvider.
const CATALOG_PROVIDERS: Record<string, CatalogProvider> = {
  movie: {
    sourceName: 'tmdb',
    search: searchMovies,
    getById: getMovieById,
    genres: MOVIE_GENRES,
    parseExternalId: (input) => parseTmdbId(input, 'movie'),
    matchHint: 'Paste a TMDB movie link or id.',
    lookupFailedError: "Couldn't find that on TMDB — check the link.",
    matchesLength: (result, length) => {
      const minutes = result.runtimeMinutes
      if (minutes == null) return false
      if (length === 'short') return minutes <= 90
      if (length === 'medium') return minutes <= 120
      if (length === 'long') return minutes <= 150
      return minutes > 150
    },
    // Ceilings rather than bands, unlike every other provider here — each option
    // is "no longer than this", so they nest.
    lengthOptions: [
      { value: 'short', label: '90 min or less', phrase: 'a runtime of 90 minutes or less' },
      { value: 'medium', label: '120 min or less', phrase: 'a runtime of 120 minutes or less' },
      { value: 'long', label: '150 min or less', phrase: 'a runtime of 150 minutes or less' },
      { value: 'very_long', label: 'Over 150 min', phrase: 'a runtime over 150 minutes' },
    ],
  },
  book: {
    sourceName: 'google-books',
    search: searchBooks,
    getById: getBookById,
    genres: BOOK_GENRES,
    seriesTypes: BOOK_SERIES_TYPES,
    parseExternalId: parseGoogleBooksId,
    matchHint: 'Paste a Google Books link or volume id.',
    lookupFailedError: "Couldn't find that on Google Books — check the link.",
    matchesLength: (result, length) => {
      const pages = result.pageCount
      if (pages == null) return false
      if (length === 'short') return pages < 250
      if (length === 'long') return pages > 500
      // Explicit, so very_long matches nothing rather than the middle band.
      return length === 'medium' && pages >= 250 && pages <= 500
    },
    lengthOptions: [
      { value: 'short', label: 'Under 250 pages', phrase: 'fewer than 250 pages' },
      { value: 'medium', label: '250–500 pages', phrase: 'between 250 and 500 pages' },
      { value: 'long', label: 'Over 500 pages', phrase: 'more than 500 pages' },
    ],
  },
  game: {
    sourceName: 'igdb',
    search: searchGames,
    getById: getGameById,
    genres: GAME_GENRES,
    playerTypes: GAME_PLAYER_TYPES,
    multiplayerTypes: GAME_MULTIPLAYER_TYPES,
    platforms: GAME_PLATFORMS,
    parseExternalId: parseIgdbId,
    matchHint: 'Paste an IGDB game link.',
    lookupFailedError: "Couldn't find that on IGDB — check the link.",
    matchesLength: (result, length) => {
      const hours = result.playtimeHours
      if (hours == null || hours === 0) return false
      if (length === 'short') return hours < 10
      if (length === 'long') return hours > 30
      return length === 'medium' && hours >= 10 && hours <= 30
    },
    lengthOptions: [
      { value: 'short', label: 'Under 10 hours', phrase: 'a playtime under 10 hours' },
      { value: 'medium', label: '10–30 hours', phrase: 'a playtime between 10 and 30 hours' },
      { value: 'long', label: 'Over 30 hours', phrase: 'a playtime over 30 hours' },
    ],
  },
  tv: {
    sourceName: 'tmdb',
    search: searchTv,
    getById: getTvShowById,
    genres: TV_GENRES,
    parseExternalId: (input) => parseTmdbId(input, 'tv'),
    matchHint: 'Paste a TMDB show link or id.',
    lookupFailedError: "Couldn't find that on TMDB — check the link.",
    matchesLength: (result, length) => {
      const seasons = result.seasonCount
      if (seasons == null) return false
      if (length === 'short') return seasons <= 2
      if (length === 'long') return seasons > 5
      return length === 'medium' && seasons >= 3 && seasons <= 5
    },
    lengthOptions: [
      { value: 'short', label: '1–2 seasons', phrase: '1 to 2 seasons' },
      { value: 'medium', label: '3–5 seasons', phrase: 'between 3 and 5 seasons' },
      { value: 'long', label: '6+ seasons', phrase: '6 or more seasons' },
    ],
  },
}

function findCatalogProvider(type: MediaType): CatalogProvider | undefined {
  return CATALOG_PROVIDERS[type]
}

// Throws rather than quietly recommending movies to someone who asked for books.
export function getCatalogProvider(type: MediaType): CatalogProvider {
  const provider = findCatalogProvider(type)
  if (!provider) throw new Error(`No catalog provider registered for media type "${type}".`)
  return provider
}

// Writes every hit into the catalog, so results are real media_items the user can
// log against.
//
// Only the catalog half is cached. The viewer's own interactions are fetched
// fresh on every render, or logging something and going back would show a stale
// status.
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 50

const searchCache = new Map<string, { storedAt: number; results: MediaItem[] }>()

function cacheKey(type: MediaType, query: string): string {
  return `${type}:${query.trim().toLowerCase()}`
}

export async function searchAndImport(db: Db, type: MediaType, query: string): Promise<MediaItem[]> {
  const key = cacheKey(type, query)
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.storedAt < SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key)
    searchCache.set(key, cached)
    return cached.results
  }

  const provider = getCatalogProvider(type)
  const results = await provider.search(query)

  // Promise.all preserves input order, so results keep their relevance ranking.
  const imported = await Promise.all(
    // sourceOverride wins when set: a fallback hit carries an id from a different
    // provider than the one registered for this type.
    results.map((result) => upsertMediaItem(db, type, result, result.sourceOverride ?? provider.sourceName)),
  )

  searchCache.set(key, { storedAt: Date.now(), results: imported })
  if (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }

  return imported
}

// sourceOverride wins when set, exactly as in searchAndImport: a fallback hit
// carries an id from a different provider, and filing it under the registered
// one makes a row its own provider can never resolve — the later by-id lookup
// (an overview, a page count) asks Google Books about an Open Library work key
// and gets nothing back for the life of the row.
//
// `fromDetailLookup` says which kind of payload this is, and only the caller
// knows: a by-id result carries credits and a runtime, a search result carries
// neither. It was hardcoded true back when both callers did their own by-id
// lookup, and the four added since do not — an import, a Steam sync or a
// recommendation run stamped its search results as fully enriched, which is the
// one thing that stops the detail page ever fetching the real record. Defaulting
// to false keeps a caller that says nothing from making that claim.
export async function upsertCatalogItem(
  db: Db,
  type: MediaType,
  result: CatalogSearchResult,
  fromDetailLookup = false,
): Promise<MediaItem> {
  return upsertMediaItem(
    db,
    type,
    result,
    result.sourceOverride ?? getCatalogProvider(type).sourceName,
    fromDetailLookup,
  )
}

// Off the response path — the page renders fine without the credit line, which
// appears on the next view. Deduped by item id, since media_items rows are
// shared and one item can be opened by several people at once.
const backfillsInFlight = new Set<number>()

export function backfillCatalogDetail(db: Db, type: MediaType, item: MediaItem): void {
  if (backfillsInFlight.has(item.id)) return
  backfillsInFlight.add(item.id)

  void (async () => {
    try {
      const provider = getCatalogProvider(type)
      const detail = await provider.getById(item.external_id)

      // null is a definitive 404, so stamp it and stop asking. A transient
      // failure throws instead and is left unstamped, so the next view retries.
      if (detail) {
        await upsertCatalogItem(db, type, detail, true)
      } else {
        await markMediaItemEnriched(db, item)
      }
    } catch {
      // Nothing to report to, and an unhandled rejection takes the process down.
    } finally {
      backfillsInFlight.delete(item.id)
    }
  })()
}

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
