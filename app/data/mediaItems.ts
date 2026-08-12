import { and, eq, inList } from 'remix/data-table'

import { parseMediaMetadata, type MediaMetadata } from './mediaMetadata.ts'

import type { Db } from './db.ts'
import {
  INTERACTION_STATUSES,
  mediaItems,
  userMediaInteractions,
  type MediaItem,
  type UserMediaInteraction,
} from './schema.ts'
import type { TmdbSearchResult } from './catalog/tmdb.ts'

export type MediaType = MediaItem['type']

// Everything here is type-agnostic: it operates on media_item_id and never
// assumes a specific `type`.

// `previous` makes this a merge, not an overwrite: search payloads carry no
// credits, runtime or description, so re-importing an enriched item from a
// search result would otherwise null out what a by-id lookup had filled in.
// Rematch passes no `previous` — it repoints the row at a different work, so
// carrying the old metadata across would be wrong.
//
// `fromDetailLookup` says which endpoint `result` came from, since only a by-id
// lookup earns the enrichedAt stamp; a search hit never carries credits and
// must not claim to have checked for them.
function buildMetadata(result: TmdbSearchResult, previous?: unknown, fromDetailLookup = false): MediaMetadata {
  const prev = previous != null ? parseMediaMetadata(previous) : null

  return {
    enrichedAt: fromDetailLookup ? Date.now() : (prev?.enrichedAt ?? null),
    releaseYear: result.releaseYear ?? prev?.releaseYear ?? null,
    posterUrl: result.posterUrl ?? prev?.posterUrl ?? null,
    overview: result.overview ?? prev?.overview ?? null,
    runtimeMinutes: result.runtimeMinutes ?? prev?.runtimeMinutes ?? null,
    pageCount: result.pageCount ?? prev?.pageCount ?? null,
    playtimeHours: result.playtimeHours ?? prev?.playtimeHours ?? null,
    seasonCount: result.seasonCount ?? prev?.seasonCount ?? null,
    creator: result.creator ?? prev?.creator ?? null,
    // `??` won't do: an empty array is truthy, so a lookup returning no stills
    // would replace a set we already had.
    images: result.images?.length ? result.images : (prev?.images ?? []),
    // Same non-empty rule as images — see above.
    platforms: result.platforms?.length ? result.platforms : (prev?.platforms ?? []),
    // Replace-if-non-empty, so a provider dropping a genre drops it here too.
    tags: result.tags?.length ? result.tags : (prev?.tags ?? []),
  }
}

export async function upsertMediaItem(
  db: Db,
  type: MediaType,
  result: TmdbSearchResult,
  // Recorded so ids from different providers can't collide.
  source: string,
  // See buildMetadata — true only when `result` came from a by-id lookup.
  fromDetailLookup = false,
): Promise<MediaItem> {
  const existing = await db.findOne(mediaItems, {
    where: { type, external_source: source, external_id: result.externalId },
  })

  const metadata = buildMetadata(result, existing?.metadata, fromDetailLookup)

  const item = existing
    ? await db.update(mediaItems, existing.id, { metadata, popularity_score: result.popularity })
    : await db.create(
        mediaItems,
        {
          type,
          external_source: source,
          external_id: result.externalId,
          title: result.title,
          metadata,
          popularity_score: result.popularity,
          created_at: Date.now(),
        },
        { returnRow: true },
      )

  return item
}

// Stamps enrichedAt without touching anything else, for when the detail lookup
// completed but had nothing to add — a 404 on the external id. Without this the
// row would look un-enriched forever and re-request on every view, which is the
// exact loop enrichedAt exists to close.
export async function markMediaItemEnriched(db: Db, item: MediaItem): Promise<void> {
  const metadata = parseMediaMetadata(item.metadata)
  await db.update(mediaItems, item.id, { metadata: { ...metadata, enrichedAt: Date.now() } })
}

export type RematchMediaItemResult = { ok: true; item: MediaItem; merged: boolean } | { ok: false; error: string }

// media_items is shared across users, so a bad match scatters several people's
// logs across the wrong item and the real one. If a user has a log on both,
// the more recently updated wins — the unique (user_id, media_item_id)
// constraint won't allow keeping both.
async function mergeInteractionsInto(db: Db, fromMediaItemId: number, toMediaItemId: number): Promise<void> {
  const interactions = await db.findMany(userMediaInteractions, { where: { media_item_id: fromMediaItemId } })

  for (const interaction of interactions) {
    const existingOnTarget = await db.findOne(userMediaInteractions, {
      where: { user_id: interaction.user_id, media_item_id: toMediaItemId },
    })

    if (!existingOnTarget) {
      await db.update(userMediaInteractions, interaction.id, { media_item_id: toMediaItemId })
    } else if (interaction.updated_at > existingOnTarget.updated_at) {
      await db.delete(userMediaInteractions, existingOnTarget.id)
      await db.update(userMediaInteractions, interaction.id, { media_item_id: toMediaItemId })
    }
    // else: the target's log is newer — leave it to be cascade-deleted.
  }
}

// Re-points an item at a different catalog entry, in place so interactions stay
// attached to the same id. Tags are fully replaced — the old ones described the
// wrong work. If the target id is already in the catalog, merges into it and
// deletes the wrong item instead.
export async function rematchMediaItem(
  db: Db,
  type: MediaType,
  mediaItemId: number,
  externalId: string,
  lookupById: (externalId: string) => Promise<TmdbSearchResult | null>,
  source: string,
  lookupFailedError: string,
): Promise<RematchMediaItemResult> {
  const existing = await db.find(mediaItems, mediaItemId)
  if (!existing) return { ok: false, error: 'Not found.' }

  if (existing.external_source === source && existing.external_id === externalId) {
    return { ok: false, error: "That's already the match." }
  }

  const collision = await db.findOne(mediaItems, {
    where: { type, external_source: source, external_id: externalId },
  })
  if (collision) {
    await mergeInteractionsInto(db, mediaItemId, collision.id)
    await db.delete(mediaItems, mediaItemId)
    return { ok: true, item: collision, merged: true }
  }

  const result = await lookupById(externalId)
  if (!result) return { ok: false, error: lookupFailedError }

  // A by-id lookup, so the row lands already enriched and the detail page has
  // no backfill left to schedule.
  const metadata = buildMetadata(result, undefined, true)

  const item = await db.update(mediaItems, mediaItemId, {
    external_source: source,
    external_id: result.externalId,
    title: result.title,
    metadata,
    popularity_score: result.popularity,
  })

  return { ok: true, item, merged: false }
}

export type InteractionStatus = (typeof INTERACTION_STATUSES)[number]

// Every status except the rejection: the three that describe engaging with
// something, in one state or another. Derived rather than listed again, so a
// status added later is included by default — only another kind of refusal
// would need excluding here too.
export const CONSUMPTION_STATUSES: readonly InteractionStatus[] = INTERACTION_STATUSES.filter(
  (status) => status !== 'not_interested',
)

// One row of a user's log: the interaction, plus the item it points at when
// that row still resolves to one.
export interface UserLogEntry {
  interaction: UserMediaInteraction
  item: MediaItem | null
}

export interface LogInteractionInput {
  status: InteractionStatus
  // Three states, not two. `undefined` leaves whatever is already stored
  // alone; `null` is the user saying "no rating" and clears it. Importers pass
  // `undefined` for a row they know nothing about, so re-running an import
  // can't wipe a rating its source never carried — see the callers in
  // data/imports/. The forms always pass one of the other two, which is what
  // makes the picker's "No rating" option stick.
  rating?: number | null
  // The dislike, on the same three-state rule as `rating` above. Not
  // independent of it: the two are one question with three answers, and
  // parseRatingSubmission is what keeps them consistent.
  disliked?: boolean | null
  notes: string | null
  // Overrides the consumed_at timestamp instead of stamping "now" — used by
  // the Letterboxd import to preserve the original watch/rating date.
  consumedAt?: number
}

// The rating scale runs 0.5-5 in half-star steps. 0 is not the bottom of it:
// "I never rated this" and "I rated this the lowest it goes" are different
// claims, and only the second one belongs on the scale. Everything at or
// below 0 — an empty submission, a tampered request, a blank cell in an
// export — resolves to null, meaning unrated.
export function parseRatingInput(raw: string): number | null {
  return normalizeRating(raw.trim() === '' ? null : Number(raw))
}

// The single gate every rating passes through, whether it came from the picker
// or an importer. Anything that isn't a usable point on the scale is unrated.
export function normalizeRating(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const rounded = Math.min(5, Math.round(raw * 2) / 2)
  return rounded < 0.5 ? null : rounded
}

// The value the picker submits when someone picks "Didn't like it" instead of
// a star. Not a number, so it can't be confused for one at any point between
// the form and the column.
export const DISLIKED_INPUT_VALUE = 'disliked'

// One field in, both columns out. The picker is a single radio group offering
// three kinds of answer — a score, a dislike, or nothing — so parsing it in one
// place is what guarantees they stay mutually exclusive. Splitting this across
// two form fields is exactly how a row ends up claiming four stars and a
// dislike at the same time.
export function parseRatingSubmission(raw: string): { rating: number | null; disliked: boolean | null } {
  if (raw.trim() === DISLIKED_INPUT_VALUE) return { rating: null, disliked: true }
  return { rating: parseRatingInput(raw), disliked: null }
}

// Atomic on (user_id, media_item_id): findOne-then-write races when the
// Letterboxd import runs 8 of these in parallel and two rows resolve to the
// same movie. The unique constraint is what makes ON CONFLICT possible.
export async function logInteraction(
  db: Db,
  userId: number,
  mediaItemId: number,
  input: LogInteractionInput,
) {
  const now = Date.now()
  const consumedAt = input.consumedAt ?? now
  // updated_at drives the watched-list sort and its "logged on" date, so a
  // caller backdating via consumedAt has to win here too — otherwise every
  // imported movie reads as "logged today". created_at stays the insert time.
  const activityAt = input.consumedAt ?? now

  const values: Partial<UserMediaInteraction> = {
    user_id: userId,
    media_item_id: mediaItemId,
    status: input.status,
    rating: input.rating ?? undefined,
    disliked: input.disliked ?? undefined,
    notes: input.notes ?? undefined,
    created_at: now,
    updated_at: activityAt,
  }
  // Omitted rather than set when not marking consumed, so a later edit to
  // status/rating/notes leaves an existing consumed_at alone.
  const update: Partial<UserMediaInteraction> = {
    status: input.status,
    notes: input.notes ?? undefined,
    updated_at: activityAt,
  }
  // Written only when the caller has an opinion: `??` would fold "no rating"
  // back into "don't touch it", which is what made a rating impossible to
  // clear once given. Same for the verdict.
  if (input.rating !== undefined) {
    update.rating = input.rating
  }
  if (input.disliked !== undefined) {
    update.disliked = input.disliked
  }
  if (input.status === 'consumed') {
    values.consumed_at = consumedAt
    update.consumed_at = consumedAt
  }

  return db.query(userMediaInteractions).upsert(values, {
    conflictTarget: ['user_id', 'media_item_id'],
    update,
    returning: '*',
  })
}

// By id rather than upserting by media item. Null if it doesn't exist or isn't
// this user's.
export async function updateInteraction(
  db: Db,
  interactionId: number,
  userId: number,
  input: LogInteractionInput,
) {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return null

  const now = Date.now()
  return db.update(userMediaInteractions, interactionId, {
    status: input.status,
    // Same three-state rule as logInteraction: undefined leaves it, null clears it.
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.disliked !== undefined ? { disliked: input.disliked } : {}),
    notes: input.notes ?? undefined,
    consumed_at: input.status === 'consumed' ? (existing.consumed_at ?? now) : (existing.consumed_at ?? undefined),
    updated_at: now,
  })
}

// False rather than throwing if it doesn't exist or isn't this user's.
export async function deleteInteraction(db: Db, interactionId: number, userId: number): Promise<boolean> {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return false

  return db.delete(userMediaInteractions, interactionId)
}

export async function getMediaItemDetail(db: Db, mediaItemId: number): Promise<MediaItem | null> {
  return (await db.find(mediaItems, mediaItemId)) ?? null
}

// One query instead of one per item — a 20-result search page was otherwise
// 20 sequential round-trips.
export async function getUserInteractionsForItems(db: Db, userId: number, mediaItemIds: number[]) {
  if (mediaItemIds.length === 0) return new Map<number, UserMediaInteraction>()

  const rows = await db.findMany(userMediaInteractions, {
    where: and(eq('user_id', userId), inList('media_item_id', mediaItemIds)),
  })
  return new Map(rows.map((row) => [row.media_item_id, row]))
}

export async function getUserInteractionForItem(db: Db, userId: number, mediaItemId: number) {
  return db.findOne(userMediaInteractions, { where: { user_id: userId, media_item_id: mediaItemId } })
}

// Two queries regardless of log size. Fetching items per-row is an N+1 that
// took a 400-item log to ~10s on the profile page, which runs this six times.
//
// The type filter stays in JS because userMediaInteractions has no `type`
// column — it lives on the joined media_items row.
export async function loadUserLogEntries(db: Db, userId: number): Promise<UserLogEntry[]> {
  const interactions = await db.findMany(userMediaInteractions, {
    where: { user_id: userId },
    orderBy: ['updated_at', 'desc'],
  })
  if (interactions.length === 0) return []

  const itemIds = [...new Set(interactions.map((interaction) => interaction.media_item_id))]
  const items = await db.findMany(mediaItems, { where: inList('id', itemIds) })
  const itemsById = new Map(items.map((item) => [item.id, item]))

  // Callers' prop types expect `MediaItem | null`.
  return interactions.map((interaction) => ({
    interaction,
    item: itemsById.get(interaction.media_item_id) ?? null,
  }))
}

// What a caller wants out of the log. Both fields stay in JS rather than
// becoming a where-clause: `type` has to (see loadUserLogEntries), and keeping
// `statuses` next to it means one predicate answers for the list and the count
// alike, which is what keeps a page's rows and its pagination in agreement.
export interface UserLogFilter {
  type?: MediaType
  // Which statuses to include. All of them when unset — the callers that pass
  // CONSUMPTION_STATUSES are the ones presenting the log as "what I've
  // engaged with", where a rejection doesn't belong.
  statuses?: readonly InteractionStatus[]
}

export function matchesLogFilter(entry: UserLogEntry, filter: UserLogFilter): boolean {
  if (filter.type && entry.item?.type !== filter.type) return false
  if (filter.statuses && !filter.statuses.includes(entry.interaction.status)) return false
  return true
}

export async function listUserMediaLog(
  db: Db,
  userId: number,
  options: UserLogFilter & { limit?: number; offset?: number } = {},
) {
  const entries = await loadUserLogEntries(db, userId)
  const filtered = entries.filter((entry) => matchesLogFilter(entry, options))

  const start = options.offset ?? 0
  const end = options.limit != null ? start + options.limit : undefined
  return filtered.slice(start, end)
}

export async function countUserMediaLog(db: Db, userId: number, filter: UserLogFilter = {}): Promise<number> {
  // An unfiltered count is the one the database can answer on its own — every
  // other shape needs the joined item row or a partitioned pass anyway.
  if (!filter.type && !filter.statuses) {
    return db.count(userMediaInteractions, { where: { user_id: userId } })
  }

  const entries = await loadUserLogEntries(db, userId)
  return entries.filter((entry) => matchesLogFilter(entry, filter)).length
}
