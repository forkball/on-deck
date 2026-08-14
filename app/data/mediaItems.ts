import { and, eq, inList } from 'remix/data-table'

import { parseMediaMetadata, type MediaMetadata } from './mediaMetadata.ts'

import { pool, type Db } from './db.ts'
import {
  INTERACTION_STATUSES,
  mediaItems,
  userMediaInteractions,
  type MediaItem,
  type UserMediaInteraction,
} from './schema.ts'
import type { TmdbSearchResult } from './catalog/tmdb.ts'

export type MediaType = MediaItem['type']

// `previous` makes this a merge, not an overwrite: a search payload carries no
// credits, runtime or description, so re-importing over an enriched row would
// null out what a by-id lookup filled in. Rematch passes none — it repoints the
// row at a different work. Only a by-id lookup earns the enrichedAt stamp.
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
    platforms: result.platforms?.length ? result.platforms : (prev?.platforms ?? []),
    tags: result.tags?.length ? result.tags : (prev?.tags ?? []),
  }
}

export async function upsertMediaItem(
  db: Db,
  type: MediaType,
  result: TmdbSearchResult,
  // Recorded so ids from different providers can't collide.
  source: string,
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

// For a detail lookup that 404'd: stamps enrichedAt and nothing else, so the row
// stops looking un-enriched and re-requesting on every view.
export async function markMediaItemEnriched(db: Db, item: MediaItem): Promise<void> {
  const metadata = parseMediaMetadata(item.metadata)
  await db.update(mediaItems, item.id, { metadata: { ...metadata, enrichedAt: Date.now() } })
}

export type RematchMediaItemResult = { ok: true; item: MediaItem; merged: boolean } | { ok: false; error: string }

// The unique (user_id, media_item_id) constraint won't allow keeping both logs,
// so where a user has one on each item the more recently updated wins.
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
// wrong work. A target already in the catalog is merged into instead.
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

// Every status except the rejection. Derived rather than listed again, so a
// status added later is included by default.
export const CONSUMPTION_STATUSES: readonly InteractionStatus[] = INTERACTION_STATUSES.filter(
  (status) => status !== 'not_interested',
)

export interface UserLogEntry {
  interaction: UserMediaInteraction
  item: MediaItem | null
}

export interface LogInteractionInput {
  status: InteractionStatus
  // Three states, not two. `undefined` leaves whatever is already stored alone;
  // `null` is the user saying "no rating" and clears it. Importers pass
  // `undefined` for a row they know nothing about, so re-running an import can't
  // wipe a rating its source never carried — see the callers in data/imports/.
  rating?: number | null
  // Same three-state rule as `rating`, and not independent of it: the two are
  // one question with three answers. parseRatingSubmission keeps them consistent.
  disliked?: boolean | null
  notes: string | null
  // Overrides consumed_at instead of stamping "now", so an import can preserve
  // the original date.
  consumedAt?: number
}

// The scale runs 0.5-5 in half-star steps. 0 is not the bottom of it: "never
// rated" and "rated the lowest it goes" are different claims, so anything at or
// below 0 resolves to null, meaning unrated.
export function parseRatingInput(raw: string): number | null {
  return normalizeRating(raw.trim() === '' ? null : Number(raw))
}

// The single gate every rating passes through, from the picker or an importer.
export function normalizeRating(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const rounded = Math.min(5, Math.round(raw * 2) / 2)
  return rounded < 0.5 ? null : rounded
}

// What the picker submits for "Didn't like it". Not a number, so it can't be
// confused for one between the form and the column.
export const DISLIKED_INPUT_VALUE = 'disliked'

// One field in, both columns out. The picker is a single radio group with three
// kinds of answer, so parsing it in one place is what keeps them mutually
// exclusive — split across two fields, a row can claim four stars and a dislike.
export function parseRatingSubmission(raw: string): { rating: number | null; disliked: boolean | null } {
  if (raw.trim() === DISLIKED_INPUT_VALUE) return { rating: null, disliked: true }
  return { rating: parseRatingInput(raw), disliked: null }
}

// Atomic on (user_id, media_item_id): findOne-then-write races when an import
// runs these in parallel and two rows resolve to the same item.
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
  // Written only when the caller has an opinion. `??` won't do: it folds "no
  // rating" back into "don't touch it", leaving a rating impossible to clear.
  // Same for the verdict.
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

export async function deleteInteraction(db: Db, interactionId: number, userId: number): Promise<boolean> {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return false

  return db.delete(userMediaInteractions, interactionId)
}

export async function getMediaItemDetail(db: Db, mediaItemId: number): Promise<MediaItem | null> {
  return (await db.find(mediaItems, mediaItemId)) ?? null
}

// One query instead of one per item, for a whole page of search results.
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

// Two queries regardless of log size — fetching items per-row is an N+1, and
// the profile page runs this once per media type.
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

  return interactions.map((interaction) => ({
    interaction,
    item: itemsById.get(interaction.media_item_id) ?? null,
  }))
}

// Both fields stay in JS rather than becoming a where-clause: `type` has to (see
// loadUserLogEntries), and keeping `statuses` beside it means one predicate
// answers for the list and the count alike, so rows and pagination agree.
export interface UserLogFilter {
  type?: MediaType
  // All of them when unset. Callers presenting the log as "what I've engaged
  // with" pass CONSUMPTION_STATUSES, where a rejection doesn't belong.
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

// Which media types each of these people has logged something in, so the
// recommendations form can grey out a run before it's requested. Rejections
// don't count, the same rule findMembersMissingSourceLogs uses.
//
// One query rather than a count per person per type: loadUserLogEntries pulls a
// whole log per call, so the obvious loop is one full load per follower per type.
export async function loadLoggedTypesByUser(userIds: number[]): Promise<Map<number, Set<MediaType>>> {
  const byUser = new Map<number, Set<MediaType>>(userIds.map((id) => [id, new Set<MediaType>()]))
  if (userIds.length === 0) return byUser

  const { rows } = await pool.query<{ user_id: number; type: MediaType }>(
    `select i.user_id, m.type
       from user_media_interactions i
       join media_items m on m.id = i.media_item_id
      where i.user_id = any($1)
        and i.status = any($2)
      group by i.user_id, m.type`,
    [userIds, [...CONSUMPTION_STATUSES]],
  )

  for (const row of rows) byUser.get(row.user_id)?.add(row.type)
  return byUser
}
