import type { Db } from './db.ts'
import type { MediaItem } from './schema.ts'
import { getTvShowById, searchTv as searchTmdbTv, type TmdbSearchResult } from './tmdb.ts'
import { rematchMediaItem, upsertMediaItem, type RematchMediaItemResult } from './mediaCatalog.ts'

export interface TvResult {
  item: MediaItem
  tags: string[]
}

export async function searchAndImportTv(db: Db, query: string): Promise<TvResult[]> {
  const results = await searchTmdbTv(query)
  const items: TvResult[] = []
  for (const result of results) {
    const item = await upsertMediaItem(db, 'tv', result)
    items.push({ item, tags: result.tags })
  }
  return items
}

export async function upsertTvShow(db: Db, result: TmdbSearchResult): Promise<MediaItem> {
  return upsertMediaItem(db, 'tv', result)
}

export type RematchTvShowResult = RematchMediaItemResult

export async function rematchTvShow(db: Db, mediaItemId: number, tmdbId: string): Promise<RematchTvShowResult> {
  return rematchMediaItem(db, 'tv', mediaItemId, tmdbId, getTvShowById)
}
