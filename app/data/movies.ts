import type { Db } from './db.ts'
import {
  mediaItems,
  mediaItemTags,
  userMediaInteractions,
  type MediaItem,
  type UserMediaInteraction,
} from './schema.ts'
import { getMovieById, searchMovies as searchTmdbMovies, type TmdbSearchResult } from './tmdb.ts'

export interface MovieResult {
  item: MediaItem
  tags: string[]
}

export async function searchAndImportMovies(db: Db, query: string): Promise<MovieResult[]> {
  const results = await searchTmdbMovies(query)
  const items: MovieResult[] = []
  for (const result of results) {
    const item = await upsertMovie(db, result)
    items.push({ item, tags: result.tags })
  }
  return items
}

export async function upsertMovie(db: Db, result: TmdbSearchResult): Promise<MediaItem> {
  const existing = await db.findOne(mediaItems, {
    where: { type: 'movie', external_source: 'tmdb', external_id: result.externalId },
  })

  const metadata = JSON.stringify({
    releaseYear: result.releaseYear,
    posterUrl: result.posterUrl,
    overview: result.overview,
  })

  const item = existing
    ? await db.update(mediaItems, existing.id, { metadata, popularity_score: result.popularity })
    : await db.create(
        mediaItems,
        {
          type: 'movie',
          external_source: 'tmdb',
          external_id: result.externalId,
          title: result.title,
          metadata,
          popularity_score: result.popularity,
          created_at: Date.now(),
        },
        { returnRow: true },
      )

  for (const tag of result.tags) {
    const existingTag = await db.findOne(mediaItemTags, {
      where: { media_item_id: item.id, tag },
    })
    if (!existingTag) {
      await db.create(mediaItemTags, { media_item_id: item.id, tag })
    }
  }

  return item
}

export type RematchMovieResult = { ok: true; item: MediaItem; merged: boolean } | { ok: false; error: string }

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

// Re-points an existing media item at a different TMDB movie — the fix for a
// bad title/year match (from search, autosuggest, or the Letterboxd import
// all silently picking a plausible-but-wrong TMDB entry). Updates the item
// in place (interactions stay attached to the same id) rather than creating
// a new item, and fully replaces its tags since the old ones described the
// wrong movie. If the target TMDB id is already a different item in the
// catalog, merges into it instead (see mergeInteractionsInto) and deletes
// the wrong item — ON DELETE CASCADE takes care of its now-orphaned tags
// and any interactions that weren't moved.
export async function rematchMovie(
  db: Db,
  mediaItemId: number,
  tmdbId: string,
): Promise<RematchMovieResult> {
  const existing = await db.find(mediaItems, mediaItemId)
  if (!existing) return { ok: false, error: 'Movie not found.' }

  if (existing.external_source === 'tmdb' && existing.external_id === tmdbId) {
    return { ok: false, error: "That's already the match for this movie." }
  }

  const collision = await db.findOne(mediaItems, {
    where: { type: 'movie', external_source: 'tmdb', external_id: tmdbId },
  })
  if (collision) {
    await mergeInteractionsInto(db, mediaItemId, collision.id)
    await db.delete(mediaItems, mediaItemId)
    return { ok: true, item: collision, merged: true }
  }

  const result = await getMovieById(tmdbId)
  if (!result) return { ok: false, error: "Couldn't find that movie on TMDB — check the link." }

  const metadata = JSON.stringify({
    releaseYear: result.releaseYear,
    posterUrl: result.posterUrl,
    overview: result.overview,
  })

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

export async function getMovieDetail(db: Db, mediaItemId: number) {
  const item = await db.find(mediaItems, mediaItemId)
  if (!item) return null

  const tagRows = await db.findMany(mediaItemTags, { where: { media_item_id: mediaItemId } })
  return { item, tags: tagRows.map((row) => row.tag) }
}

export async function getUserInteractionForItem(db: Db, userId: number, mediaItemId: number) {
  return db.findOne(userMediaInteractions, { where: { user_id: userId, media_item_id: mediaItemId } })
}

export async function listUserMovieLog(
  db: Db,
  userId: number,
  options: { limit?: number; offset?: number } = {},
) {
  const interactions = await db.findMany(userMediaInteractions, {
    where: { user_id: userId },
    orderBy: ['updated_at', 'desc'],
    limit: options.limit,
    offset: options.offset,
  })

  return Promise.all(
    interactions.map(async (interaction) => ({
      interaction,
      item: await db.find(mediaItems, interaction.media_item_id),
    })),
  )
}

export async function countUserMovieLog(db: Db, userId: number): Promise<number> {
  return db.count(userMediaInteractions, { where: { user_id: userId } })
}
