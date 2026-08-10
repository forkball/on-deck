import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'

// `search` cannot be combined with `sort` — that pairing 406s — so relevance
// ranking happens here rather than in the query.
const IGDB_API = 'https://api.igdb.com/v4'
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

// IGDB serves 4 requests/second.
export const IGDB_MAX_CONCURRENCY = 4

// game_type values from /v4/game_types that count as "a game someone played".
// Excluding mods/DLC/expansions/episodes/seasons/packs/updates matters:
// otherwise "hollow knight" returns an unofficial Vita port, catalogued as a
// mod, above the real game. Bundles and ports stay in — people own games under
// those names ("Tony Hawk's Pro Skater 1+2").
const REAL_GAME_TYPES = '(0,3,4,8,9,10,11)'

const SEARCH_LIMIT = 20

// The player-type / multiplayer-type filters' vocabulary. Unlike GAME_GENRES,
// these aren't a straight passthrough of an IGDB reference table: IGDB's
// game_modes distinguishes co-op from other multiplayer, but has nothing for
// "free-for-all" specifically, so that option is left out rather than guessed.
export const GAME_PLAYER_TYPES: string[] = ['singleplayer', 'multiplayer']
export const GAME_MULTIPLAYER_TYPES: string[] = ['coop', 'versus']

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
  game_modes?: { name: string }[]
  involved_companies?: { developer?: boolean; company?: { name?: string } }[]
  platforms?: { name?: string; abbreviation?: string }[]
  // How many people have rated it — fan games and asset flips sit at 0.
  total_rating_count?: number
}

interface IgdbTimeToBeat {
  game_id: number
  // All in seconds.
  normally?: number
  hastily?: number
  completely?: number
}

// Unlike the other providers, IGDB has no static key: the Twitch id/secret are
// exchanged for a ~56-day bearer token, cached here and renewed on demand.
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

// Bounding caller concurrency isn't enough — four workers making two requests
// per item sustain ~8/s and get 429'd — so the pacing lives here, where every
// caller inherits it. `nextSlot` only advances synchronously, so concurrent
// callers can't be handed the same slot. Divided by machine count because each
// process enforces its own share of the limit.
const IGDB_REQUESTS_PER_SECOND = 4

function machineCount(): number {
  const configured = Number(process.env.MACHINE_COUNT)
  return Number.isFinite(configured) && configured > 0 ? configured : 2
}

const MIN_REQUEST_SPACING_MS = 1000 / (IGDB_REQUESTS_PER_SECOND / machineCount())
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

  // A token revoked before its stated expiry reads as 401; clear it so the next
  // call re-authenticates rather than failing forever.
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
  'fields name,first_release_date,summary,total_rating_count,cover.url,screenshots.url,genres.name,game_modes.name,' +
  'involved_companies.developer,involved_companies.company.name,platforms.name,platforms.abbreviation;'

// IGDB's own game_modes vocabulary (from /v4/game_modes). It has no "versus"
// mode of its own, and its plain "Multiplayer" flag turns out to mean "more
// than one player," not "competitive" — measured live, It Takes Two and
// Stardew Valley (both co-op, neither competitive) carry "Multiplayer" right
// alongside "Co-operative." So "Multiplayer" only counts as versus when
// "Co-operative" is absent; a game with both real co-op and real competitive
// modes under-tags as coop-only rather than over-tagging pure co-op as
// versus, which would actively mislead someone filtering for it.
const SINGLEPLAYER_MODE = 'Single player'
const MULTIPLAYER_MODE = 'Multiplayer'
const COOP_MODE = 'Co-operative'
// Delivery/scale variants, not intent — each one coexists with either
// Co-operative or plain Multiplayer, so they only ever widen the general
// "multiplayer" tag, never the versus/coop split.
const OTHER_MULTIPLAYER_MODES = ['Split screen', 'Massively Multiplayer Online (MMO)', 'Battle Royale']

// Not exclusive with each other — a game with both a co-op campaign and
// competitive modes should match a filter on either.
function derivePlayerTags(gameModes: { name: string }[] | undefined): string[] {
  const names = (gameModes ?? []).map((mode) => mode.name)
  const isCoop = names.includes(COOP_MODE)
  const isMultiplayer =
    isCoop || names.includes(MULTIPLAYER_MODE) || names.some((name) => OTHER_MULTIPLAYER_MODES.includes(name))
  const isVersus = names.includes(MULTIPLAYER_MODE) && !isCoop

  const tags: string[] = []
  if (names.includes(SINGLEPLAYER_MODE)) tags.push('singleplayer')
  if (isMultiplayer) tags.push('multiplayer')
  if (isCoop) tags.push('coop')
  if (isVersus) tags.push('versus')
  return tags
}

// IGDB returns a 90x90 t_thumb URL and expects the size to be swapped in the
// path. Protocol-relative, so it also needs a scheme.
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
    tags: [...(game.genres ?? []).map((genre) => genre.name.toLowerCase()), ...derivePlayerTags(game.game_modes)],
    posterUrl: image(game.cover?.url, 't_cover_big'),
    popularity: game.total_rating_count ?? 0,
    overview: game.summary?.trim() || null,
    runtimeMinutes: null,
    pageCount: null,
    playtimeHours: hoursToBeat,
    creator: developerOf(game),
    images: stills,
    // Abbreviations — the full names ("PC (Microsoft Windows)") don't fit a card.
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
    // `normally` is the headline figure; fall back so a completionist-only
    // time still yields a length.
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

  // IGDB's relevance puts "Elden Ring Nightreign" above "Elden Ring", and it
  // won't sort a search server-side. Exact title first, then rating count.
  const wanted = normalize(query)
  const ranked = [...games].sort((a, b) => {
    const exact = Number(normalize(b.name ?? '') === wanted) - Number(normalize(a.name ?? '') === wanted)
    if (exact !== 0) return exact
    return (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0)
  })

  const hours = await hoursToBeatFor(ranked.map((game) => game.id))

  return ranked.map((game) => toResult(game, hours.get(game.id) ?? null))
}

// Takes a numeric id or a slug. Either way external_id comes from the response,
// so a slug never reaches the database.
export async function getGameById(externalId: string): Promise<CatalogSearchResult | null> {
  const value = externalId.trim()
  if (!value) return null

  const selector = /^\d+$/.test(value)
    ? `where id = ${value};`
    : // parseIgdbId's character class strips quotes, so this can't break out.
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

// Fuzzy search misses exact titles surprisingly often ("For the King" returns
// unrelated games) while `where slug = …` finds them immediately.
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Pulls a game reference out of whatever someone pasted — normally the page
// URL (igdb.com/games/hollow-knight), but a bare numeric id works too. The
// character class keeps quotes out of the APICalypse literal built from it.
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
