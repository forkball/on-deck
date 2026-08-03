import { and, eq, inList } from 'remix/data-table'

import { parseMediaMetadata, type MediaMetadata } from './mediaMetadata.ts'

import type { Db } from './db.ts'
import { mediaItems, userMediaInteractions, type MediaItem, type UserMediaInteraction } from './schema.ts'
import type { TmdbSearchResult } from './catalog/tmdb.ts'

export type MediaType = MediaItem['type']

// Everything here is type-agnostic: it operates on media_item_id and never
// assumes a specific `type`.

// `previous` makes this a merge, not an overwrite: search payloads carry no
// credits, runtime or description, so re-importing an enriched item from a
// search result would otherwise null out what a by-id lookup had filled in.
// Rematch passes no `previous` — it repoints the row at a different work, so
// carrying the old metadata across would be wrong.
function buildMetadata(result: TmdbSearchResult, previous?: unknown): MediaMetadata {
  const prev = previous != null ? parseMediaMetadata(previous) : null

  return {
    releaseYear: result.releaseYear ?? prev?.releaseYear ?? null,
    posterUrl: result.posterUrl ?? prev?.posterUrl ?? null,
    overview: result.overview ?? prev?.overview ?? null,
    runtimeMinutes: result.runtimeMinutes ?? prev?.runtimeMinutes ?? null,
    pageCount: result.pageCount ?? prev?.pageCount ?? null,
    playtimeHours: result.playtimeHours ?? prev?.playtimeHours ?? null,
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
): Promise<MediaItem> {
  const existing = await db.findOne(mediaItems, {
    where: { type, external_source: source, external_id: result.externalId },
  })

  const metadata = buildMetadata(result, existing?.metadata)

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

  const metadata = buildMetadata(result)

  const item = await db.update(mediaItems, mediaItemId, {
    external_id: result.externalId,
    title: result.title,
    metadata,
    popularity_score: result.popularity,
  })

  return { ok: true, item, merged: false }
}

export interface LogInteractionInput {
  status: 'want_to_consume' | 'in_progress' | 'consumed'
  rating: number | null
  notes: string | null
  // Overrides the consumed_at timestamp instead of stamping "now" — used by
  // the Letterboxd import to preserve the original watch/rating date.
  consumedAt?: number
}

// Clamps to 0.5-5 in half-star steps — the picker only submits valid values,
// but the request could be tampered with.
export function parseRatingInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !Number.isFinite(Number(trimmed))) return null
  return Math.min(5, Math.max(0.5, Math.round(Number(trimmed) * 2) / 2))
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
    notes: input.notes ?? undefined,
    created_at: now,
    updated_at: activityAt,
  }
  // Omitted rather than set when not marking consumed, so a later edit to
  // status/rating/notes leaves an existing consumed_at alone.
  const update: Partial<UserMediaInteraction> = {
    status: input.status,
    rating: input.rating ?? undefined,
    notes: input.notes ?? undefined,
    updated_at: activityAt,
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
    rating: input.rating ?? undefined,
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
export async function loadUserLogEntries(db: Db, userId: number) {
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

export async function listUserMediaLog(
  db: Db,
  userId: number,
  options: { limit?: number; offset?: number; type?: MediaType } = {},
) {
  const entries = await loadUserLogEntries(db, userId)
  const filtered = options.type ? entries.filter(({ item }) => item?.type === options.type) : entries

  const start = options.offset ?? 0
  const end = options.limit != null ? start + options.limit : undefined
  return filtered.slice(start, end)
}

export async function countUserMediaLog(db: Db, userId: number, type?: MediaType): Promise<number> {
  if (!type) return db.count(userMediaInteractions, { where: { user_id: userId } })

  const entries = await loadUserLogEntries(db, userId)
  return entries.filter(({ item }) => item?.type === type).length
}
