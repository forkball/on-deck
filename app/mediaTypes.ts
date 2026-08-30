import type { InteractionStatus, MediaType } from './data/mediaItems.ts'
import { INTERACTION_STATUSES } from './data/schema.ts'
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

// Types in the vocabulary that aren't ready to be shown. Empty today.
//
// A gated type stays in ACTIVE_MEDIA_TYPES — that tuple forces every consumer to
// have an answer, so removing one would silently delete the guarantee. Opt-in,
// so a forgotten variable hides a half-finished type rather than shipping it.
const EXPERIMENTAL_MEDIA_TYPES: readonly ActiveMediaType[] = []

function experimentalEnabled(): Set<string> {
  return new Set(
    (process.env.EXPERIMENTAL_MEDIA_TYPES ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

export function isMediaTypeEnabled(type: ActiveMediaType): boolean {
  if (!EXPERIMENTAL_MEDIA_TYPES.includes(type)) return true
  return experimentalEnabled().has(type)
}

export function enabledMediaTypes(): ActiveMediaType[] {
  return ACTIVE_MEDIA_TYPES.filter(isMediaTypeEnabled)
}

// For anything a visitor supplies. parseMediaType stays ungated because it also
// reads back existing rows — a logged game needs its verbs whether or not its
// tab is showing.
export function parseEnabledMediaType(value: unknown): ActiveMediaType | null {
  const type = parseMediaType(value)
  return type && isMediaTypeEnabled(type) ? type : null
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

export function mediaTypeLabel(value: unknown): string {
  const type = parseMediaType(value)
  return type ? MEDIA_TYPE_UI[type].tabLabel : String(value)
}

export function isActiveMediaType(type: MediaType): type is ActiveMediaType {
  return parseMediaType(type) !== null
}

export type { InteractionStatus }

export function parseInteractionStatus(value: unknown): InteractionStatus | null {
  return INTERACTION_STATUSES.includes(value as InteractionStatus) ? (value as InteractionStatus) : null
}

// Same four statuses everywhere; only the verbs differ, and those live on the
// registry above so adding a type doesn't mean editing a second table.
//
// "Not interested" takes no verb — you decline a book as you decline a film — so
// it isn't in StatusVerbs, and it goes last as the one that isn't a stage of
// consuming anything.
export function statusOptionsFor(mediaType: ActiveMediaType): { value: InteractionStatus; label: string }[] {
  const verbs = MEDIA_TYPE_UI[mediaType].statusVerbs
  return [
    { value: 'want_to_consume', label: verbs.want },
    { value: 'in_progress', label: verbs.inProgress },
    { value: 'consumed', label: verbs.done },
    { value: 'not_interested', label: 'Not interested' },
  ]
}

export function statusLabelsFor(mediaType: ActiveMediaType): Record<string, string> {
  return Object.fromEntries(statusOptionsFor(mediaType).map((o) => [o.value, o.label]))
}

export function statusLabel(status: string, mediaType?: unknown): string {
  const type = parseMediaType(mediaType) ?? DEFAULT_MEDIA_TYPE
  return statusLabelsFor(type)[status] ?? status
}

const STATUS_BADGE_COLORS: Record<InteractionStatus, string> = {
  want_to_consume: '#1d4ed8',
  in_progress: '#b45309',
  consumed: '#15803d',
  not_interested: '#6b7280',
}

export function statusBadgeColor(status: string): string {
  return STATUS_BADGE_COLORS[status as InteractionStatus] ?? '#555'
}
