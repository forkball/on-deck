import type { Db } from './db.ts'
import { mediaItems, mediaItemTags, userMediaInteractions, type MediaItem } from './schema.ts'
import { searchMovies as searchTmdbMovies, type TmdbSearchResult } from './tmdb.ts'

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

export interface LogInteractionInput {
  status: 'want_to_consume' | 'in_progress' | 'consumed'
  rating: number | null
  notes: string | null
}

export async function logInteraction(
  db: Db,
  userId: number,
  mediaItemId: number,
  input: LogInteractionInput,
) {
  const existing = await db.findOne(userMediaInteractions, {
    where: { user_id: userId, media_item_id: mediaItemId },
  })

  const now = Date.now()

  if (existing) {
    return db.update(userMediaInteractions, existing.id, {
      status: input.status,
      rating: input.rating ?? undefined,
      notes: input.notes ?? undefined,
      consumed_at: input.status === 'consumed' ? now : (existing.consumed_at ?? undefined),
      updated_at: now,
    })
  }

  return db.create(
    userMediaInteractions,
    {
      user_id: userId,
      media_item_id: mediaItemId,
      status: input.status,
      rating: input.rating ?? undefined,
      notes: input.notes ?? undefined,
      consumed_at: input.status === 'consumed' ? now : undefined,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
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
