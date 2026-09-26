import {
  getWatchProviders,
  tmdbKindOf,
  type RegionWatchProviders,
  type WatchProvidersByRegion,
} from './catalog/tmdb.ts'
import { pool } from './db.ts'
import type { MediaItem } from './schema.ts'

// The shapes the page renders, re-exported so the UI reads them from here rather
// than from a provider module.
export type { RegionWatchProviders, WatchProvider } from './catalog/tmdb.ts'

// How long a stored answer is shown before it is asked for again. Services add
// and drop titles monthly at most; a week keeps the list honest without a
// request on every view.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

// The longest a first view waits. Past it the page renders without the list,
// while the fetch carries on and is stored for the next view — a slow TMDB
// costs a missing section, not a slow page, and not the request itself.
const FIRST_VIEW_WAIT_MS = 2500

// The longest any fetch may run, so a hung connection can't hold its slot in
// `inFlight` until the socket gives up minutes later.
const FETCH_TIMEOUT_MS = 15_000

// One request per title at a time, shared by every view that needs it: a first
// view waiting on it, a stale view refreshing behind the page, or both. Settles
// to null on failure rather than rejecting, so a caller that stops listening
// can't leave a rejection unhandled.
const inFlight = new Map<number, Promise<WatchProvidersByRegion | null>>()

// Where a movie or show can be watched in one country. Null when there is
// nothing to say yet: not a TMDB title, or never fetched and the fetch didn't
// finish in time. `providers` null is different — TMDB lists it nowhere there.
//
// Only that country is read, though every country is stored: one request
// answers for all of them, so switching country never needs another.
export async function loadWatchProviders(
  item: Pick<MediaItem, 'id' | 'type' | 'external_source' | 'external_id'>,
  region: string,
): Promise<{ providers: RegionWatchProviders | null } | null> {
  const kind = tmdbKindOf(item)
  if (!kind) return null

  const { rows } = await pool.query<{ fetched_at: number; providers: RegionWatchProviders | null }>(
    'select fetched_at, regions -> $2::text as providers from media_watch_providers where media_item_id = $1',
    [item.id, region],
  )
  const stored = rows[0]
  if (stored) {
    if (Date.now() - stored.fetched_at > STALE_AFTER_MS) void fetchOnce(item.id, kind, item.external_id)
    return { providers: stored.providers }
  }

  const regions = await withinWait(fetchOnce(item.id, kind, item.external_id))
  return regions ? { providers: regions[region] ?? null } : null
}

function fetchOnce(
  mediaItemId: number,
  kind: 'movie' | 'tv',
  externalId: string,
): Promise<WatchProvidersByRegion | null> {
  const pending = inFlight.get(mediaItemId)
  if (pending) return pending

  const request = fetchAndStore(mediaItemId, kind, externalId)
    // Nothing is stored on failure, so the next view asks again.
    .catch(() => null)
    .finally(() => inFlight.delete(mediaItemId))
  inFlight.set(mediaItemId, request)
  return request
}

// The fetch's answer if it comes within FIRST_VIEW_WAIT_MS, else null — without
// cancelling it.
async function withinWait<T>(pending: Promise<T | null>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIRST_VIEW_WAIT_MS)
  })
  try {
    return await Promise.race([pending, gaveUp])
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAndStore(
  mediaItemId: number,
  kind: 'movie' | 'tv',
  externalId: string,
): Promise<WatchProvidersByRegion> {
  // A title TMDB doesn't know is stored as available nowhere, so it isn't asked
  // about again until the answer goes stale.
  const regions = (await getWatchProviders(kind, externalId, AbortSignal.timeout(FETCH_TIMEOUT_MS))) ?? {}

  // An upsert, because a first view and a refresh can race — and the table API
  // has no `on conflict`.
  await pool.query(
    `insert into media_watch_providers (media_item_id, regions, fetched_at)
     values ($1, $2, $3)
     on conflict (media_item_id) do update set regions = excluded.regions, fetched_at = excluded.fetched_at`,
    [mediaItemId, JSON.stringify(regions), Date.now()],
  )
  return regions
}
