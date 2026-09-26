import { MEDIA_TYPE_UI, parseMediaType } from '../../mediaTypes.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import type { MediaItem } from '../schema.ts'

export interface CatalogPage {
  // The catalog's name, for "View on …".
  name: string
  url: string
}

// Where a media_items row came from, on the web. Keyed by external_source rather
// than by media type, because books come from two catalogs — a row carrying an
// Open Library work key has no Google Books page to link to.
//
// Null for a source this doesn't know, rather than a guess: the link is only
// worth showing when it lands on the entry itself.
export function catalogPageFor(
  item: Pick<MediaItem, 'type' | 'external_source' | 'external_id' | 'title' | 'metadata'>,
): CatalogPage | null {
  const id = encodeURIComponent(item.external_id)

  switch (item.external_source) {
    case 'tmdb':
      // The same id space is not shared: movie 1396 and show 1396 are different
      // works, so the path has to come from the row's type.
      if (item.type === 'movie') return { name: 'TMDB', url: `https://www.themoviedb.org/movie/${id}` }
      if (item.type === 'tv') return { name: 'TMDB', url: `https://www.themoviedb.org/tv/${id}` }
      return null
    case 'google-books':
      return { name: 'Google Books', url: `https://books.google.com/books?id=${id}` }
    case 'openlibrary':
      return { name: 'Open Library', url: `https://openlibrary.org/works/${id}` }
    case 'igdb': {
      // IGDB addresses its pages by slug, which the numeric id can't be turned
      // back into, so the page URL is stored off the API response. Rows fetched
      // before that have none, and get a search for the title instead — a guessed
      // slug would 404 for every title IGDB disambiguates.
      const { sourceUrl } = parseMediaMetadata(item.metadata)
      const game = MEDIA_TYPE_UI.game
      if (sourceUrl) return { name: game.catalogName, url: sourceUrl }
      return parseMediaType(item.type) === 'game'
        ? { name: game.catalogName, url: game.catalogSearchUrl(item.title) }
        : null
    }
    default:
      return null
  }
}
