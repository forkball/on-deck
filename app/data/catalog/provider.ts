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
import { GAME_GENRES, GAME_MULTIPLAYER_TYPES, GAME_PLAYER_TYPES, getGameById, parseIgdbId, searchGames } from './igdb.ts'
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

// The provider-agnostic name for a catalog hit — structurally what TMDB
// returns, aliased so non-TMDB providers can satisfy the same contract.
export type CatalogSearchResult = TmdbSearchResult

// Short/medium/long(/very long), in whatever unit a given provider measures —
// runtime, page count, hours to beat, season count. Defined here rather than
// with the recommendation filters that read it: the buckets belong to the
// catalog that interprets them. `very_long` exists only for providers with a
// 4th tier (currently movies) — the rest just never emit it in their
// lengthOptions.
export type LengthBucket = 'short' | 'medium' | 'long' | 'very_long'

// Everything that differs between one media type's catalog and another's.
// Anything not here is type-agnostic and lives in mediaItems.ts.
export interface CatalogProvider {
  // Recorded as media_items.external_source, so ids can't collide.
  sourceName: string
  search(query: string): Promise<CatalogSearchResult[]>
  getById(externalId: string): Promise<CatalogSearchResult | null>
  // Genre vocabulary offered by the recommendation filter for this type.
  genres: string[]
  // Games-only: no other provider has a player-count concept, so these are
  // absent (rather than empty) for every other type.
  playerTypes?: string[]
  multiplayerTypes?: string[]
  // Books-only — see BOOK_SERIES_TYPES.
  seriesTypes?: string[]
  // Turns what the "wrong match?" form accepts — a pasted URL or bare id —
  // into an external id, or null.
  parseExternalId(input: string): string | null
  // Shown when parseExternalId rejects the input.
  matchHint: string
  // Shown when the id parsed fine but the catalog had no such entry.
  lookupFailedError: string
  // In whatever unit the medium is measured in — minutes, pages, hours,
  // seasons. Lives on the provider because one global check can only be right
  // for a single medium: reading runtimeMinutes unconditionally silently
  // dropped every book.
  matchesLength(result: CatalogSearchResult, length: LengthBucket): boolean
  // Every bucket this provider offers — the buckets it omits are ones it has no
  // meaning for, so a provider's own list is what `length` may validly be.
  //
  // `label` is for the form, `phrase` for the pick prompt, and they live on the
  // same entry so a bucket can't reach one and not the other. They used to be
  // separate, and the prompt's copy was movie-shaped for every medium: asking
  // for long books requested books "with a runtime of 150 minutes or less" —
  // wrong unit, and backwards, since long books are the ones over 500 pages.
  lengthOptions: { value: LengthBucket; label: string; phrase: string }[]
}

// Fits after "Only suggest books with …". Null when this medium doesn't offer
// the bucket at all, in which case there's nothing truthful to ask for.
export function describeLength(provider: CatalogProvider, length: LengthBucket): string | null {
  return provider.lengthOptions.find((option) => option.value === length)?.phrase ?? null
}

// Keyed by MediaType, which widens to `string` through the row types — so this
// is deliberately partial, and callers fail loudly rather than substituting
// movies for a type with no provider.
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
    // Ceilings rather than bands, unlike every other provider here: each option
    // is "no longer than this", so they nest deliberately.
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
      // Explicit, so a bucket this provider doesn't offer (very_long) matches
      // nothing rather than falling into the middle band.
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
    parseExternalId: parseIgdbId,
    matchHint: 'Paste an IGDB game link.',
    lookupFailedError: "Couldn't find that on IGDB — check the link.",
    matchesLength: (result, length) => {
      const hours = result.playtimeHours
      if (hours == null || hours === 0) return false
      if (length === 'short') return hours < 10
      if (length === 'long') return hours > 30
      // See the book entry — very_long isn't offered here either.
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
      // See the book entry — very_long isn't offered here either.
      return length === 'medium' && seasons >= 3 && seasons <= 5
    },
    // A show has no single runtime the way a film does — episode counts and
    // lengths both vary too much within a series to bucket on. Season count is
    // the one number that actually reads as "how much of a commitment is this".
    lengthOptions: [
      { value: 'short', label: '1–2 seasons', phrase: '1 to 2 seasons' },
      { value: 'medium', label: '3–5 seasons', phrase: 'between 3 and 5 seasons' },
      { value: 'long', label: '6+ seasons', phrase: '6 or more seasons' },
    ],
  },
}

export function findCatalogProvider(type: MediaType): CatalogProvider | undefined {
  return CATALOG_PROVIDERS[type]
}

// Better to throw than quietly recommend movies to someone who asked for books.
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

const searchCache = new Map<string, { storedAt: number; results: MediaItem[] }>()

function cacheKey(type: MediaType, query: string): string {
  return `${type}:${query.trim().toLowerCase()}`
}

export async function searchAndImport(db: Db, type: MediaType, query: string): Promise<MediaItem[]> {
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
  // Genre tags used to be returned alongside each item, because they lived in
  // a separate table the caller had no other way to reach. They ride in the
  // item's own metadata now, so the row is the whole result.
  const imported = await Promise.all(
    // sourceOverride wins when set — a fallback hit (Google Books down,
    // served from Open Library instead) carries an id that belongs to a
    // different provider than the one registered for this type.
    results.map((result) => upsertMediaItem(db, type, result, result.sourceOverride ?? provider.sourceName)),
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
  // Both callers (the import action and the detail page's backfill) hand this a
  // by-id result, so the row is stamped as enriched.
  return upsertMediaItem(db, type, result, getCatalogProvider(type).sourceName, true)
}

// Credits only come back from a by-id lookup, so anything that entered the
// catalog via search has none. The detail page fills that gap on first view —
// but off the response path, because the page renders fine without it: the
// credit line is the only thing that waits, and it appears on the next view.
//
// Deduped by item id. media_items rows are shared across users, so a popular
// item can be opened by several people at once, and each of them firing the
// same lookup and the same write is pure waste.
const backfillsInFlight = new Set<number>()

export function backfillCatalogDetail(db: Db, type: MediaType, item: MediaItem): void {
  if (backfillsInFlight.has(item.id)) return
  backfillsInFlight.add(item.id)

  void (async () => {
    try {
      const provider = getCatalogProvider(type)
      const detail = await provider.getById(item.external_id)

      // null is a definitive 404 — the id is gone from the catalog, so stamp it
      // and stop asking. A transient failure throws instead, and is left
      // unstamped deliberately so the next view retries.
      if (detail) {
        await upsertCatalogItem(db, type, detail)
      } else {
        await markMediaItemEnriched(db, item)
      }
    } catch {
      // Nothing to report to: the response this was scheduled from is long
      // sent. Swallowing keeps a catalog outage from taking the process down
      // on an unhandled rejection.
    } finally {
      backfillsInFlight.delete(item.id)
    }
  })()
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
