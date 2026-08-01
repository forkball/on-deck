import { and, eq, inList } from 'remix/data-table'

import { parseMediaMetadata } from '../utils/mediaMetadata.ts'

import type { Db } from './db.ts'
import {
  mediaItems,
  mediaItemTags,
  userMediaInteractions,
  type MediaItem,
  type UserMediaInteraction,
} from './schema.ts'
import type { TmdbSearchResult } from './tmdb.ts'

export type MediaType = MediaItem['type']

// Shared by movies.ts and tv.ts (and any future media type) — everything
// here is genuinely type-agnostic: it operates on media_item_id, never
// assumes a specific `type`, and only the thin per-type wrapper modules
// (movies.ts, tv.ts) know which TMDB endpoint or which `type` value to pass.

// Single place the metadata blob is assembled, so upsert and rematch can't
// drift on which fields they persist. See utils/mediaMetadata.ts for the
// read side.
//
// `previous` makes this a merge rather than an overwrite, and that matters:
// search payloads carry no credits, runtime, or (for books) description, so
// re-importing an already-enriched item from a search result would otherwise
// null out everything the by-id lookup had filled in. A known value is never
// replaced by an absent one.
//
// Rematch deliberately passes no `previous` — it repoints the row at a
// different work entirely, so carrying the old title's metadata across would
// be wrong rather than helpful.
function buildMetadata(result: TmdbSearchResult, previous?: string): string {
  const prev = previous ? parseMediaMetadata(previous) : null

  return JSON.stringify({
    releaseYear: result.releaseYear ?? prev?.releaseYear ?? null,
    posterUrl: result.posterUrl ?? prev?.posterUrl ?? null,
    overview: result.overview ?? prev?.overview ?? null,
    runtimeMinutes: result.runtimeMinutes ?? prev?.runtimeMinutes ?? null,
    pageCount: result.pageCount ?? prev?.pageCount ?? null,
    playtimeHours: result.playtimeHours ?? prev?.playtimeHours ?? null,
    creator: result.creator ?? prev?.creator ?? null,
  })
}

export async function upsertMediaItem(
  db: Db,
  type: MediaType,
  result: TmdbSearchResult,
  // Which catalog this came from — recorded so ids from different providers
  // (TMDB for film, Open Library for books) can never collide.
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

  // Read every existing tag in one query and write only the missing ones,
  // concurrently. This used to be a findOne + create *per tag*, in series —
  // eight sequential round-trips for a four-tag item, against a remote
  // database, multiplied by every search result.
  if (result.tags.length > 0) {
    const existingTags = await db.findMany(mediaItemTags, { where: { media_item_id: item.id } })
    const known = new Set(existingTags.map((row) => row.tag))
    const missing = result.tags.filter((tag) => !known.has(tag))
    await Promise.all(missing.map((tag) => db.create(mediaItemTags, { media_item_id: item.id, tag })))
  }

  return item
}

export type RematchMediaItemResult = { ok: true; item: MediaItem; merged: boolean } | { ok: false; error: string }

// The catalog is shared across users (media_items isn't per-user), so a bad
// title/year match can end up with two or more people's logs scattered
// across a wrong item and the real one. Moves every interaction on the wrong
// item onto the real one. If a given user already has a log on both (rare —
// they logged the wrong item, then separately found and logged the right
// one), keeps whichever was updated more recently and drops the other,
// since the unique (user_id, media_item_id) constraint won't allow both.
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
    // else: the target's own log is newer — leave interaction where it is,
    // it'll be cascade-deleted along with the rest of the wrong item.
  }
}

// Re-points an existing media item at a different TMDB entry — the fix for a
// bad title/year match (from search, autosuggest, or the Letterboxd import
// all silently picking a plausible-but-wrong TMDB entry). Updates the item
// in place (interactions stay attached to the same id) rather than creating
// a new item, and fully replaces its tags since the old ones described the
// wrong thing. If the target TMDB id is already a different item in the
// catalog, merges into it instead (see mergeInteractionsInto) and deletes
// the wrong item — ON DELETE CASCADE takes care of its now-orphaned tags
// and any interactions that weren't moved.
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

  await db.deleteMany(mediaItemTags, { where: { media_item_id: mediaItemId } })
  for (const tag of result.tags) {
    await db.create(mediaItemTags, { media_item_id: mediaItemId, tag })
  }

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

// Atomic upsert on (user_id, media_item_id) — a plain findOne-then-write
// here would race under concurrent callers (the Letterboxd import runs 8 of
// these in parallel; two rows resolving to the same movie could both see "no
// existing row" and both insert). The DB-level unique constraint is what
// makes ON CONFLICT possible at all; see the matching migration.
export async function logInteraction(
  db: Db,
  userId: number,
  mediaItemId: number,
  input: LogInteractionInput,
) {
  const now = Date.now()
  const consumedAt = input.consumedAt ?? now
  // updated_at drives both the "What I've watched" sort order and the
  // "logged on" date shown per row (watched-list-item.tsx) — when a caller
  // backdates via consumedAt (the Letterboxd import), that backdate should
  // win here too, or every imported movie would show up as "logged today."
  // created_at stays as the true insert time regardless, for bookkeeping.
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
  // Only touched when actively marking something consumed — omitting the
  // key from `update` (rather than setting it) leaves an existing
  // consumed_at alone when just editing status/rating/notes later.
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

// Updates an existing interaction directly by id (the editable-log flow on the
// profile page), rather than upserting by media item. Returns null if the
// interaction doesn't exist or doesn't belong to this user.
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

// Returns false (rather than throwing) if the interaction doesn't exist or
// doesn't belong to this user, matching updateInteraction's ownership check.
export async function deleteInteraction(db: Db, interactionId: number, userId: number): Promise<boolean> {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return false

  return db.delete(userMediaInteractions, interactionId)
}

export async function getMediaItemDetail(db: Db, mediaItemId: number) {
  const item = await db.find(mediaItems, mediaItemId)
  if (!item) return null

  const tagRows = await db.findMany(mediaItemTags, { where: { media_item_id: mediaItemId } })
  return { item, tags: tagRows.map((row) => row.tag) }
}

// Batched counterpart to getUserInteractionForItem, for pages that show a
// list of items and need each one's status. One query instead of one per
// item — a 20-result search page was otherwise 20 sequential round-trips.
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

// Loads a user's interactions joined to their media items in two queries
// rather than one-per-row.
//
// This was previously an `await db.find(...)` inside a map, i.e. an N+1: a
// 400-item log issued 400 queries, and the profile page runs this six times
// (list + count, per media type), so a single page load could fire thousands
// and take ~10s. Batching the item fetch through one `inList` makes it two
// queries regardless of log size.
//
// The type filter still happens in JS: userMediaInteractions has no `type`
// column of its own (it lives on the joined media_items row), and filtering
// after a batched join is cheap now that the join isn't the bottleneck.
export async function loadUserLogEntries(db: Db, userId: number) {
  const interactions = await db.findMany(userMediaInteractions, {
    where: { user_id: userId },
    orderBy: ['updated_at', 'desc'],
  })
  if (interactions.length === 0) return []

  const itemIds = [...new Set(interactions.map((interaction) => interaction.media_item_id))]
  const items = await db.findMany(mediaItems, { where: inList('id', itemIds) })
  const itemsById = new Map(items.map((item) => [item.id, item]))

  // `?? null` keeps the previous contract: db.find returned null for a
  // missing row, and callers' prop types expect `MediaItem | null`.
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
