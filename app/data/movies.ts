import type { Db } from './db.ts'
import type { MediaItem } from './schema.ts'
import { getMovieById, searchMovies as searchTmdbMovies, type TmdbSearchResult } from './tmdb.ts'
import { rematchMediaItem, upsertMediaItem, type RematchMediaItemResult } from './mediaCatalog.ts'

export interface MovieResult {
  item: MediaItem
  tags: string[]
}

export async function searchAndImportMovies(db: Db, query: string): Promise<MovieResult[]> {
  const results = await searchTmdbMovies(query)
  const items: MovieResult[] = []
  for (const result of results) {
    const item = await upsertMediaItem(db, 'movie', result)
    items.push({ item, tags: result.tags })
  }
  return items
}

export async function upsertMovie(db: Db, result: TmdbSearchResult): Promise<MediaItem> {
  return upsertMediaItem(db, 'movie', result)
}

export type RematchMovieResult = RematchMediaItemResult

export async function rematchMovie(db: Db, mediaItemId: number, tmdbId: string): Promise<RematchMovieResult> {
  return rematchMediaItem(db, 'movie', mediaItemId, tmdbId, getMovieById)
}

// Generic — see mediaCatalog.ts. Re-exported under their established
// movie-flavored names since every existing caller (profile/movie pages,
// the Letterboxd import, taste profile, recommendations) already imports
// them from here.
export {
  logInteraction,
  updateInteraction,
  deleteInteraction,
  getUserInteractionForItem,
  type LogInteractionInput,
} from './mediaCatalog.ts'

export { getMediaItemDetail as getMovieDetail } from './mediaCatalog.ts'
export { listUserMediaLog as listUserMovieLog, countUserMediaLog as countUserMovieLog } from './mediaCatalog.ts'
