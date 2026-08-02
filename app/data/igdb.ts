import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'

// IGDB (Twitch) video game importer, replacing rawg.ts. Every claim below was
// probed against the live API before this was written:
//
//  - It carries real portrait cover art *and* 16:9 screenshots, which RAWG
//    never had — RAWG only had landscape key art, which is why games had to
//    be shown as a carousel with no poster.
//  - Console exclusives resolve properly. Zelda: Tears of the Kingdom, Super
//    Mario Odyssey and Bloodborne all return with covers, which neither Steam
//    (a storefront) nor Steam's box art could do.
//  - `search` cannot be combined with `sort` — that pairing 406s — so
//    relevance ranking has to happen here rather than in the query.
const IGDB_API = 'https://api.igdb.com/v4'
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

// IGDB serves 4 requests/second. Anything batching lookups (the Steam
// importer) has to respect this.
export const IGDB_MAX_CONCURRENCY = 4

// game_type values worth treating as "a game someone played", from
// /v4/game_types.
//
// The exclusions are what matter: mods (5), DLC (1), expansions (2),
// episodes (6), seasons (7), packs (13) and updates (14) aren't things you
// own and play on their own. Without this, searching "hollow knight" returns
// an unofficial Vita port — catalogued as a mod — above the real game, the
// same junk problem RAWG had in different clothes.
//
// Bundles, standalone expansions, expanded games and ports are included
// because people genuinely own them under those names: "Devil May Cry HD
// Collection", "Tony Hawk's Pro Skater 1+2" and "Deus Ex: Human Revolution -
// Director's Cut" are all catalogued that way and were unmatchable while this
// was narrower. Verified that widening doesn't bring the mod back.
const REAL_GAME_TYPES = '(0,3,4,8,9,10,11)'

const SEARCH_LIMIT = 20

// The genre filter's vocabulary, from /v4/genres.
export const GAME_GENRES: string[] = [
  'adventure',
  'arcade',
  'card & board game',
  'fighting',
  'hack and slash/beat em up',
  'indie',
  'moba',
  'music',
  'pinball',
  'platform',
  'point-and-click',
  'puzzle',
  'quiz/trivia',
  'racing',
  'real time strategy (rts)',
  'role-playing (rpg)',
  'shooter',
  'simulator',
  'sport',
  'strategy',
  'tactical',
  'turn-based strategy (tbs)',
  'visual novel',
]

interface IgdbImage {
  url: string
}

interface IgdbGame {
  id: number
  name?: string
  // Unix seconds.
  first_release_date?: number
  summary?: string | null
  cover?: IgdbImage
  screenshots?: IgdbImage[]
  genres?: { name: string }[]
  involved_companies?: { developer?: boolean; company?: { name?: string } }[]
  platforms?: { name?: string; abbreviation?: string }[]
  // Stands in for RAWG's library-adds count: how many people have rated it.
  // Fan games and asset flips sit at 0 while real games run into thousands.
  total_rating_count?: number
}

interface IgdbTimeToBeat {
  game_id: number
  // All in seconds.
  normally?: number
  hastily?: number
  completely?: number
}

// Unlike every other provider here, IGDB isn't authenticated with a static
// key. The Twitch client id and secret are exchanged for a bearer token that
// lasts about 56 days, so it's cached in module scope and renewed on demand
// rather than fetched per request.
let cachedToken: { value: string; expiresAt: number } | null = null

// A minute of slack, so a token that expires mid-flight isn't sent.
const TOKEN_SKEW_MS = 60_000

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_SKEW_MS) {
    return cachedToken.value
  }

  const clientId = process.env.TWITCH_CLIENT_ID
  const clientSecret = process.env.TWITCH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required')
  }

  const url = new URL(TWITCH_TOKEN_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)
  url.searchParams.set('grant_type', 'client_credentials')

  const response = await fetch(url, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Twitch token request failed: ${response.status}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }

  return cachedToken.value
}

// IGDB enforces 4 requests/second and answers 429 above it. Bounding caller
// *concurrency* isn't enough, which is how the first migration run failed:
// four workers each making two requests per item (the game, then its
// time-to-beat) sustained roughly eight per second and got refused.
//
// So the limit lives here, where every caller inherits it, rather than in
// each caller's own bookkeeping. Requests claim a slot 1/4 second after the
// previous one; `nextSlot` is only ever advanced synchronously, so
// concurrent callers can't be handed the same slot.
const MIN_REQUEST_SPACING_MS = 1000 / 4
let nextSlot = 0

async function claimRateLimitSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + MIN_REQUEST_SPACING_MS

  const wait = slot - now
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// IGDB takes APICalypse in the request body — its own query language, not
// JSON and not query parameters.
async function igdbQuery<T>(endpoint: string, body: string): Promise<T[]> {
  const token = await accessToken()
  await claimRateLimitSlot()

  const response = await fetch(`${IGDB_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  })

  // A token revoked before its stated expiry reads as 401; clearing the cache
  // means the next call re-authenticates rather than failing forever.
  if (response.status === 401) {
    cachedToken = null
    throw new Error('IGDB rejected the access token')
  }
  if (!response.ok) {
    throw new Error(`IGDB request failed: ${response.status} ${await response.text()}`)
  }

  return (await response.json()) as T[]
}

const GAME_FIELDS =
  'fields name,first_release_date,summary,total_rating_count,cover.url,screenshots.url,genres.name,' +
  'involved_companies.developer,involved_companies.company.name,platforms.name,platforms.abbreviation;'

// IGDB hands back a t_thumb URL — 90x90, useless for display — and expects
// the size to be swapped in the path. Also protocol-relative, so it needs a
// scheme before a browser will load it.
function image(raw: string | undefined, size: string): string | null {
  if (!raw) return null
  return `https:${raw.replace('t_thumb', size)}`
}

function toResult(game: IgdbGame, hoursToBeat: number | null): CatalogSearchResult {
  const stills = (game.screenshots ?? [])
    .map((shot) => image(shot.url, 't_1080p'))
    .filter((url): url is string => url !== null)

  return {
    externalId: String(game.id),
    title: game.name ?? 'Untitled',
    releaseYear: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
    tags: (game.genres ?? []).map((genre) => genre.name.toLowerCase()),
    // A real portrait cover, so games sit alongside films and books in a grid
    // instead of needing their own shape.
    posterUrl: image(game.cover?.url, 't_cover_big'),
    popularity: game.total_rating_count ?? 0,
    overview: game.summary?.trim() || null,
    runtimeMinutes: null,
    pageCount: null,
    playtimeHours: hoursToBeat,
    creator: developerOf(game),
    images: stills,
    // Abbreviations, because the full names are unusable on a card: IGDB
    // calls it "PC (Microsoft Windows)" and "Xbox Series X|S". Stored in full
    // and grouped into families at render time, so nothing is thrown away
    // here that the detail page might want.
    platforms: (game.platforms ?? [])
      .map((platform) => platform.abbreviation || platform.name)
      .filter((name): name is string => Boolean(name)),
  }
}

function developerOf(game: IgdbGame): string | null {
  const developer = (game.involved_companies ?? []).find((company) => company.developer)
  return developer?.company?.name ?? null
}

// Time-to-beat lives on its own endpoint keyed by game id, so it's fetched
// once for a whole page of results rather than per game.
async function hoursToBeatFor(gameIds: number[]): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map()

  const rows = await igdbQuery<IgdbTimeToBeat>(
    'game_time_to_beats',
    `fields game_id,normally,hastily,completely; where game_id = (${gameIds.join(',')}); limit ${gameIds.length};`,
  )

  const hours = new Map<number, number>()
  for (const row of rows) {
    // Seconds, and `normally` is the headline figure — falling back to the
    // other two so a game with only a completionist time still gets a length.
    const seconds = row.normally ?? row.hastily ?? row.completely
    if (seconds) hours.set(row.game_id, Math.round(seconds / 3600))
  }

  return hours
}

export async function searchGames(query: string): Promise<CatalogSearchResult[]> {
  const escaped = query.replace(/"/g, '')

  const games = await igdbQuery<IgdbGame>(
    'games',
    `${GAME_FIELDS} search "${escaped}"; where game_type = ${REAL_GAME_TYPES} & cover != null; limit ${SEARCH_LIMIT};`,
  )

  // IGDB's own relevance puts "Elden Ring Nightreign" above "Elden Ring" and
  // a fan project above "Super Mario Odyssey", and it refuses to sort a
  // search server-side — so results are re-ranked here. Exact title first,
  // then by how many people have rated it.
  const wanted = normalize(query)
  const ranked = [...games].sort((a, b) => {
    const exact = Number(normalize(b.name ?? '') === wanted) - Number(normalize(a.name ?? '') === wanted)
    if (exact !== 0) return exact
    return (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0)
  })

  const hours = await hoursToBeatFor(ranked.map((game) => game.id))

  return ranked.map((game) => toResult(game, hours.get(game.id) ?? null))
}

// Accepts either the numeric id or the slug from a game's igdb.com URL —
// whichever parseIgdbId pulled out of what was pasted. Either way the stored
// external_id comes from the response, so a slug never ends up in the
// database.
export async function getGameById(externalId: string): Promise<CatalogSearchResult | null> {
  const value = externalId.trim()
  if (!value) return null

  const selector = /^\d+$/.test(value)
    ? `where id = ${value};`
    : // Quotes are stripped by parseIgdbId's character class, so this can't
      // break out of the string literal.
      `where slug = "${value}";`

  try {
    const games = await igdbQuery<IgdbGame>('games', `${GAME_FIELDS} ${selector} limit 1;`)
    const game = games[0]
    if (!game) return null

    const hours = await hoursToBeatFor([game.id])
    return toResult(game, hours.get(game.id) ?? null)
  } catch {
    return null
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// IGDB's own slug form of a title, for the fallback above: its fuzzy search
// misses exact titles surprisingly often — "For the King" and "We Who Are
// About to Die" both return unrelated games — while `where slug = …` finds
// them immediately.
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Pulls a game reference out of whatever someone pasted.
//
// The thing a person actually has is the page URL —
// igdb.com/games/hollow-knight — so that's what this takes. It resolves,
// contrary to an earlier comment here: `where slug = "hollow-knight"` returns
// the game, verified against all of Hollow Knight, Elden Ring and Tears of
// the Kingdom. That assumption came from RAWG, whose slug lookups 502'd.
//
// A bare numeric id still works for anyone who has one, and the character
// class keeps quotes out of the APICalypse string literal built from it.
export function parseIgdbId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  // Only /games/ — a link to a company or franchise page isn't a game.
  const slug = trimmed.match(/igdb\.com\/games\/([a-z0-9-]+)/i)
  if (slug) return slug[1].toLowerCase()

  // The API form, in case anyone is working from the docs.
  const apiId = trimmed.match(/api\.igdb\.com\/v\d+\/games\/(\d+)/i)
  return apiId ? apiId[1] : null
}
