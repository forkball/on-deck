import type { MediaType } from './data/mediaItems.ts'
import { routes } from './routes.ts'

export const ACTIVE_MEDIA_TYPES = ['movie', 'tv', 'book', 'game'] as const

export type ActiveMediaType = (typeof ACTIVE_MEDIA_TYPES)[number]

export const DEFAULT_MEDIA_TYPE: ActiveMediaType = 'movie'

export function parseMediaType(value: unknown): ActiveMediaType | null {
  return ACTIVE_MEDIA_TYPES.includes(value as ActiveMediaType) ? (value as ActiveMediaType) : null
}

// The `type` a list URL carries, for appending to a query string that already
// has something in it — hence the leading `&`. Empty for the default type,
// because a reader that finds no `type` falls back to DEFAULT_MEDIA_TYPE: the
// writing end and the reading end have to name the same constant, so it is
// named once, here.
export function mediaTypeQuery(mediaType: ActiveMediaType): string {
  return mediaType === DEFAULT_MEDIA_TYPE ? '' : `&type=${mediaType}`
}

interface StatusVerbs {
  want: string
  inProgress: string
  done: string
}

interface MediaTypeUi {
  slug: string
  tabLabel: string
  singular: string
  plural: string
  attributive: string
  entryNoun: string
  itemNoun: string
  catalogName: string
  rematchPlaceholder: string
  // Sends the "wrong match?" form to where the id it asks for lives. Whether the
  // year helps is per-catalog — see each entry.
  catalogSearchUrl: (title: string, year: number | null) => string
  searchPlaceholder: string
  searchHeading: string
  statusVerbs: StatusVerbs
  creditLabel: string
  pastParticiple: string
  // Closures, not Route objects: routes.movies.show and routes.tv.show are
  // different generic instantiations, and TypeScript won't call a union of
  // their signatures.
  hrefs: {
    search: () => string
    suggest: () => string
    import: () => string
    show: (mediaItemId: number) => string
    log: (mediaItemId: number) => string
    rematch: (mediaItemId: number) => string
  }
}

const WATCH_VERBS: StatusVerbs = { want: 'Want to watch', inProgress: 'Watching', done: 'Watched' }
const READ_VERBS: StatusVerbs = { want: 'Want to read', inProgress: 'Reading', done: 'Read' }
const PLAY_VERBS: StatusVerbs = { want: 'Want to play', inProgress: 'Playing', done: 'Played' }

export const MEDIA_TYPE_UI = {
  movie: {
    slug: 'movies',
    tabLabel: 'Movies',
    singular: 'movie',
    plural: 'movies',
    attributive: 'movie',
    entryNoun: 'entry',
    itemNoun: 'movie',
    catalogName: 'TMDB',
    rematchPlaceholder: 'Paste a themoviedb.org link or id',
    // Year unused: TMDB's web search ignores ?year=, and folding it into the
    // query text measurably worsens matching.
    catalogSearchUrl: (title) => `https://www.themoviedb.org/search/movie?query=${encodeURIComponent(title)}`,
    searchPlaceholder: 'Search for a movie…',
    searchHeading: 'Search movies',
    statusVerbs: WATCH_VERBS,
    pastParticiple: 'watched',
    creditLabel: 'Director',
    hrefs: {
      search: () => routes.movies.search.href(),
      suggest: () => routes.movies.suggest.href(),
      import: () => routes.movies.import.href(),
      show: (id) => routes.movies.show.href({ mediaItemId: String(id) }),
      log: (id) => routes.movies.log.href({ mediaItemId: String(id) }),
      rematch: (id) => routes.movies.rematch.href({ mediaItemId: String(id) }),
    },
  },
  tv: {
    slug: 'tv',
    tabLabel: 'TV',
    singular: 'TV show',
    plural: 'TV shows',
    attributive: 'TV',
    entryNoun: 'show',
    itemNoun: 'show',
    catalogName: 'TMDB',
    rematchPlaceholder: 'Paste a themoviedb.org link or id',
    // See the movie entry — TMDB ignores the year on web search.
    catalogSearchUrl: (title) => `https://www.themoviedb.org/search/tv?query=${encodeURIComponent(title)}`,
    searchPlaceholder: 'Search for a TV show…',
    searchHeading: 'Search TV',
    statusVerbs: WATCH_VERBS,
    pastParticiple: 'watched',
    creditLabel: 'Creator',
    hrefs: {
      search: () => routes.tv.search.href(),
      suggest: () => routes.tv.suggest.href(),
      import: () => routes.tv.import.href(),
      show: (id) => routes.tv.show.href({ mediaItemId: String(id) }),
      log: (id) => routes.tv.log.href({ mediaItemId: String(id) }),
      rematch: (id) => routes.tv.rematch.href({ mediaItemId: String(id) }),
    },
  },
  book: {
    slug: 'books',
    tabLabel: 'Books',
    singular: 'book',
    plural: 'books',
    attributive: 'book',
    entryNoun: 'book',
    itemNoun: 'book',
    catalogName: 'Google Books',
    rematchPlaceholder: 'Paste a Google Books link or volume id',
    // Folded into the query text, same as every other catalog's search page —
    // Google Books' web search has no dedicated year filter either.
    catalogSearchUrl: (title, year) =>
      `https://books.google.com/books?q=${encodeURIComponent(year ? `${title} ${year}` : title)}`,
    searchPlaceholder: 'Search for a book…',
    searchHeading: 'Search books',
    statusVerbs: READ_VERBS,
    pastParticiple: 'read',
    creditLabel: 'Author',
    hrefs: {
      search: () => routes.books.search.href(),
      suggest: () => routes.books.suggest.href(),
      import: () => routes.books.import.href(),
      show: (id) => routes.books.show.href({ mediaItemId: String(id) }),
      log: (id) => routes.books.log.href({ mediaItemId: String(id) }),
      rematch: (id) => routes.books.rematch.href({ mediaItemId: String(id) }),
    },
  },
  game: {
    slug: 'games',
    tabLabel: 'Games',
    singular: 'game',
    plural: 'games',
    attributive: 'game',
    entryNoun: 'game',
    itemNoun: 'game',
    catalogName: 'IGDB',
    rematchPlaceholder: 'Paste an igdb.com link',
    catalogSearchUrl: (title) => `https://www.igdb.com/search?type=1&q=${encodeURIComponent(title)}`,
    searchPlaceholder: 'Search for a game…',
    searchHeading: 'Search games',
    statusVerbs: PLAY_VERBS,
    pastParticiple: 'played',
    creditLabel: 'Developer',
    hrefs: {
      search: () => routes.games.search.href(),
      suggest: () => routes.games.suggest.href(),
      import: () => routes.games.import.href(),
      show: (id) => routes.games.show.href({ mediaItemId: String(id) }),
      log: (id) => routes.games.log.href({ mediaItemId: String(id) }),
      rematch: (id) => routes.games.rematch.href({ mediaItemId: String(id) }),
    },
  },
} satisfies Record<ActiveMediaType, MediaTypeUi>

// For code holding a MediaType off a database row. Row types widen the column
// to `string`, so those callers can't index MEDIA_TYPE_UI directly.
export function mediaTypeUiFor(type: MediaType): MediaTypeUi {
  return MEDIA_TYPE_UI[parseMediaType(type) ?? DEFAULT_MEDIA_TYPE]
}
