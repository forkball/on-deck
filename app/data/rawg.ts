import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'

// RAWG video game importer — the games counterpart to tmdb.ts and
// openLibrary.ts. Verified against the live API before writing this:
//
//  - Coverage is the reason it's here rather than Steam. Steam is keyless but
//    is a *store*: it returns nothing at all for "zelda tears of the kingdom"
//    or "super mario odyssey". RAWG finds both.
//  - Lookups must use the numeric id, not the slug. /games/hollow-knight
//    returned a 502 while /games/9767 was reliable across repeated calls.
//  - Genres are a fixed 19-item vocabulary of clean names, so unlike Open
//    Library's free-form subjects they need no normalizing — just lowercasing.
const RAWG_API_BASE = 'https://api.rawg.io/api'

// RAWG's own "how many people have this in a library" count. Real games score
// in the thousands; fan demakes and asset flips that share a name score 0-1
// ("Hollow Knight-Scene Design", "Hollow Knight: Silksong DEMAKE"). Unlike
// Open Library, cover art doesn't separate them — the junk has images too.
const MIN_ADDED = 3

const SEARCH_LIMIT = 20

// The genre filter's vocabulary, from /genres. Fixed and small enough to
// inline rather than fetch on every page load.
export const GAME_GENRES: string[] = [
  'action',
  'adventure',
  'arcade',
  'board games',
  'card',
  'casual',
  'educational',
  'family',
  'fighting',
  'indie',
  'massively multiplayer',
  'platformer',
  'puzzle',
  'racing',
  'rpg',
  'shooter',
  'simulation',
  'sports',
  'strategy',
]

interface RawgGame {
  id: number
  name?: string
  released?: string | null
  background_image?: string | null
  genres?: { name: string }[]
  // Median hours to finish, per RAWG's users. Present on both search and
  // detail, and what the length filter reads.
  playtime?: number
  added?: number
  metacritic?: number | null
  // Search-only, and free — the search response already carries the stills,
  // so the carousel costs no extra request. The detail endpoint doesn't
  // return them; getGameById asks /screenshots separately.
  //
  // The first entry has id -1 and repeats background_image, so it's dropped
  // rather than shown twice.
  short_screenshots?: { id: number; image: string }[]
  // Detail-only, like TMDB's credits and Open Library's description.
  developers?: { name: string }[]
  description_raw?: string | null
}

interface RawgScreenshotsResponse {
  results?: { image: string }[]
}

interface RawgSearchResponse {
  results?: RawgGame[]
}

function apiKey(): string {
  const key = process.env.RAWG_API_KEY
  if (!key) throw new Error('RAWG_API_KEY is required')
  return key
}

function toResult(game: RawgGame): CatalogSearchResult {
  return {
    externalId: String(game.id),
    title: game.name ?? 'Untitled',
    releaseYear: game.released ? Number(game.released.slice(0, 4)) : null,
    tags: (game.genres ?? []).map((genre) => genre.name.toLowerCase()),
    posterUrl: game.background_image ?? null,
    // Library adds stand in for TMDB's popularity score.
    popularity: game.added ?? 0,
    overview: game.description_raw?.trim() || null,
    runtimeMinutes: null,
    pageCount: null,
    // Hours to finish. Stored on the shared result so the provider's
    // matchesLength can read it without another lookup.
    playtimeHours: game.playtime ?? null,
    creator: game.developers?.[0]?.name ?? null,
    images: screenshotsOf(game),
  }
}

// Key art first, then the stills — so the carousel opens on the image that
// would otherwise have been the poster.
function screenshotsOf(game: RawgGame): string[] {
  const stills = (game.short_screenshots ?? []).filter((shot) => shot.id !== -1).map((shot) => shot.image)

  return dedupe([game.background_image, ...stills])
}

function dedupe(urls: (string | null | undefined)[]): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))]
}

async function rawgFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${RAWG_API_BASE}${path}`)
  url.searchParams.set('key', apiKey())
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`RAWG request failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

export async function searchGames(query: string): Promise<CatalogSearchResult[]> {
  const data = (await rawgFetch('/games', {
    search: query,
    page_size: String(SEARCH_LIMIT),
  })) as RawgSearchResponse

  return (data.results ?? []).filter((game) => (game.added ?? 0) >= MIN_ADDED).map(toResult)
}

// Numeric id only — the slug form of this endpoint proved unreliable.
export async function getGameById(externalId: string): Promise<CatalogSearchResult | null> {
  const id = externalId.trim()
  if (!/^\d+$/.test(id)) return null

  try {
    const game = (await rawgFetch(`/games/${id}`)) as RawgGame
    const result = toResult(game)

    // The detail endpoint drops short_screenshots, so an id lookup would
    // otherwise return fewer images than a search and — via buildMetadata's
    // merge — leave an already-populated carousel untouched but never fill
    // an empty one. One extra request keeps the two paths equivalent.
    const shots = (await rawgFetch(`/games/${id}/screenshots`)) as RawgScreenshotsResponse
    result.images = dedupe([game.background_image, ...(shots.results ?? []).map((shot) => shot.image)])

    return result
  } catch {
    return null
  }
}

// RAWG game pages are rawg.io/games/<slug>, which the API can't resolve
// reliably — so the "wrong game?" form takes the numeric id. Accepts a bare
// id, or the id embedded in an api.rawg.io URL.
export function parseRawgId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  const match = trimmed.match(/rawg\.io\/api\/games\/(\d+)/i)
  return match ? match[1] : null
}
