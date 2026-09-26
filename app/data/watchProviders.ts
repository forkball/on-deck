import { getWatchProviders, type RegionWatchProviders } from './catalog/tmdb.ts'
import { pool, type Db } from './db.ts'
import { mediaWatchProviders, type MediaItem } from './schema.ts'

// How long a stored answer is shown before it is asked for again. Services add
// and drop titles monthly at most; a week keeps the list honest without a
// request on every view.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

// The longest a first view will wait. Past it the page renders without the
// list, and the fetch lands for the next view instead — a slow TMDB should cost
// a missing section, not a slow page.
const FIRST_FETCH_TIMEOUT_MS = 2500

const refreshesInFlight = new Set<number>()

export type WatchProvidersByRegion = Record<string, RegionWatchProviders>

// Streaming availability for a movie or show, every country at once. Null when
// there is nothing to say yet: not a TMDB title, or never fetched and the fetch
// failed. An empty object is different — it is TMDB saying "nowhere".
//
// A title never asked about is fetched now, since the section is empty
// otherwise. One asked about more than a week ago is shown as stored and
// refreshed behind the page, the same way backfillCatalogDetail fills in a
// credit line.
export async function loadWatchProviders(
  db: Db,
  item: Pick<MediaItem, 'id' | 'type' | 'external_source' | 'external_id'>,
): Promise<WatchProvidersByRegion | null> {
  const kind = tmdbKindOf(item)
  if (!kind) return null

  const stored = await db.findOne(mediaWatchProviders, { where: { media_item_id: item.id } })
  if (stored) {
    if (Date.now() - stored.fetched_at > STALE_AFTER_MS) refreshInBackground(item.id, kind, item.external_id)
    return stored.regions as WatchProvidersByRegion
  }

  try {
    return await fetchAndStore(item.id, kind, item.external_id, AbortSignal.timeout(FIRST_FETCH_TIMEOUT_MS))
  } catch {
    // Timed out, or TMDB is down: nothing is stored, so the next view asks again.
    return null
  }
}

function tmdbKindOf(item: Pick<MediaItem, 'type' | 'external_source'>): 'movie' | 'tv' | null {
  if (item.external_source !== 'tmdb') return null
  return item.type === 'movie' || item.type === 'tv' ? item.type : null
}

function refreshInBackground(mediaItemId: number, kind: 'movie' | 'tv', externalId: string): void {
  if (refreshesInFlight.has(mediaItemId)) return
  refreshesInFlight.add(mediaItemId)

  void fetchAndStore(mediaItemId, kind, externalId)
    // The stale answer stays, and the next view tries again.
    .catch(() => {})
    .finally(() => refreshesInFlight.delete(mediaItemId))
}

async function fetchAndStore(
  mediaItemId: number,
  kind: 'movie' | 'tv',
  externalId: string,
  signal?: AbortSignal,
): Promise<WatchProvidersByRegion> {
  // A title TMDB doesn't know is stored as available nowhere, so it isn't asked
  // about again until the answer goes stale.
  const regions = (await getWatchProviders(kind, externalId, signal)) ?? {}

  // An upsert, because two first views can race — and the table API has no
  // `on conflict`.
  await pool.query(
    `insert into media_watch_providers (media_item_id, regions, fetched_at)
     values ($1, $2, $3)
     on conflict (media_item_id) do update set regions = excluded.regions, fetched_at = excluded.fetched_at`,
    [mediaItemId, JSON.stringify(regions), Date.now()],
  )
  return regions
}
