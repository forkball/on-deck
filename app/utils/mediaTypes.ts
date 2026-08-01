import type { MediaType } from '../data/mediaCatalog.ts'
import { routes } from '../routes.ts'

// The media types that are actually searchable and loggable today. The DB
// enum (see schema.ts) also allows game; this is the narrower
// "wired up end to end" list. Adding a type here makes TypeScript enumerate
// every place that owes it an answer, via the `satisfies` below — which is
// exactly the property the old `=== 'tv' ? … : 'movie'` checks lacked, since
// those silently treated anything unrecognized as a movie.
export const ACTIVE_MEDIA_TYPES = ['movie', 'tv', 'book', 'game'] as const

export type ActiveMediaType = (typeof ACTIVE_MEDIA_TYPES)[number]

export const DEFAULT_MEDIA_TYPE: ActiveMediaType = 'movie'

// Narrows an untrusted string (query param, form field, DB column widened to
// `string` by the table row types) to a type we can actually serve. Returns
// null rather than defaulting, so each caller decides whether "unknown" means
// fall back to movies or reject the request.
export function parseMediaType(value: unknown): ActiveMediaType | null {
  return ACTIVE_MEDIA_TYPES.includes(value as ActiveMediaType) ? (value as ActiveMediaType) : null
}

// Types that exist in the vocabulary but aren't ready to be shown.
//
// They stay in ACTIVE_MEDIA_TYPES on purpose: that tuple is what makes
// `satisfies Record<ActiveMediaType, …>` force every consumer to have an
// answer, and dropping a type from it to hide it would silently delete that
// guarantee. Gating is a separate, runtime question.
//
// Opt-in rather than opt-out, so nothing has to be configured in production
// for a half-finished type to stay hidden — forgetting to set a variable
// hides it, rather than shipping it.
const EXPERIMENTAL_MEDIA_TYPES: readonly ActiveMediaType[] = ['game']

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

// The types to actually show, in the registry's order. Read at call time
// rather than module load so the environment can differ per deployment
// without a rebuild.
export function enabledMediaTypes(): ActiveMediaType[] {
  return ACTIVE_MEDIA_TYPES.filter(isMediaTypeEnabled)
}

// For anything a visitor supplies — a ?tab=, a form field, a saved
// preference. Distinct from parseMediaType, which stays ungated because it
// also reads back rows already in the database: a logged game still needs
// its own status verbs on a shared list, whether or not the tab is showing.
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
  // Route segment and CSS panel suffix. Plural, unlike MediaType itself —
  // this is the single place that mismatch is reconciled.
  slug: string
  tabLabel: string
  // Nouns for prose. `plural` is what the recommendation prompts use.
  singular: string
  plural: string
  // Used attributively before another noun — "movie taste profile",
  // "TV taste profile". Distinct from tabLabel ('Movies') and singular
  // ('TV show'), neither of which reads correctly in that position.
  attributive: string
  // Used when asking Claude to confirm a match — "the same show" reads better
  // than "the same entry" for TV.
  entryNoun: string
  // How one item is referred to conversationally: "Wrong movie?" / "Wrong
  // show?", "Log this movie" / "Log this show". Shorter than `singular`,
  // which would give the stilted "Wrong TV show?".
  itemNoun: string
  // The catalog these items come from, named in user-facing copy.
  catalogName: string
  rematchPlaceholder: string
  // Deep link into the external catalog's own search, pre-filled with the
  // item's title — so the "wrong match?" form can send people straight to
  // where the id it's asking for actually lives. Whether the year is usable
  // is per-catalog and was measured, not assumed; see each entry.
  catalogSearchUrl: (title: string, year: number | null) => string
  // Deliberately doesn't name the catalog: which service backs a search
  // is an implementation detail, and it changes per type. The rematch
  // form still names it, because there you're pasting a link from it.
  searchPlaceholder: string
  // Page heading and <title> on the search route.
  searchHeading: string
  // Verbs differ per medium: you watch a film but read a book.
  statusVerbs: StatusVerbs
  // How the primary credit is labelled on a detail page.
  creditLabel: string
  // Past participle for prose — "What I've watched" / "What I've read".
  // Kept separate from statusVerbs.done so copy doesn't depend on how a
  // status label happens to be capitalised.
  pastParticiple: string
  // Href builders are closures, not Route objects on purpose: routes.movies.show
  // and routes.tv.show are different generic instantiations, and TypeScript
  // won't let you call a union of their signatures. Closures keep the call
  // sites type-checked at the definition instead.
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
    // Year deliberately unused: TMDB's web search returns identical results
    // for ?year=2010 and ?year=1994, so the param is ignored, and folding the
    // year into the query text instead measurably *worsens* matching.
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
    catalogName: 'Open Library',
    rematchPlaceholder: 'Paste an openlibrary.org link or work id',
    // Open Library *does* honour a year, but only as a field filter:
    // "stoner 1965" as free text returns Hamlet, while
    // "stoner first_publish_year:1965" returns exactly the right editions.
    catalogSearchUrl: (title, year) =>
      `https://openlibrary.org/search?q=${encodeURIComponent(
        year ? `${title} first_publish_year:${year}` : title,
      )}`,
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

// Convenience for the common "I have a possibly-unknown type, give me
// something renderable" case.
export function mediaTypeUi(type: ActiveMediaType): MediaTypeUi {
  return MEDIA_TYPE_UI[type]
}

// For prose about a type that may have come from the DB widened to `string`
// (e.g. media_items.type on a recommendation row).
export function mediaTypeLabel(value: unknown): string {
  const type = parseMediaType(value)
  return type ? MEDIA_TYPE_UI[type].tabLabel : String(value)
}

// Guards against a MediaType that isn't wired up yet reaching UI that assumes
// it is. Kept separate from parseMediaType so callers holding a DB MediaType
// don't have to launder it through `unknown`.
export function isActiveMediaType(type: MediaType): type is ActiveMediaType {
  return parseMediaType(type) !== null
}
