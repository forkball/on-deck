import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'

// `search` cannot be combined with `sort` — that pairing 406s — so relevance
// ranking happens here rather than in the query.
const IGDB_API = 'https://api.igdb.com/v4'
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

export const IGDB_MAX_CONCURRENCY = 4

// game_type values from /v4/game_types that count as "a game someone played".
// Excluding mods/DLC/expansions/packs matters: "hollow knight" otherwise returns
// an unofficial Vita port above the real game. Bundles stay in — people own
// games under those names ("Tony Hawk's Pro Skater 1+2").
const REAL_GAME_TYPES = '(0,3,4,8,9,10,11)'

const SEARCH_LIMIT = 20

// The player-type / multiplayer-type vocabulary. Not a passthrough of an IGDB
// reference table like GAME_GENRES: game_modes distinguishes co-op from other
// multiplayer but has nothing for "free-for-all", so that option is left out.
export const GAME_PLAYER_TYPES: string[] = ['singleplayer', 'multiplayer']
export const GAME_MULTIPLAYER_TYPES: string[] = ['coop', 'versus']

// Families rather than IGDB's raw platform list: Hades alone returns eight
// entries, and the question is which box it runs on, not "PS4 but not PS5".
// Ordered, so two games never list the same platforms differently.
const PLATFORM_FAMILIES: { label: string; match: RegExp }[] = [
  { label: 'PC', match: /^(PC|Win|DOS)/i },
  { label: 'PlayStation', match: /^(PS|PlayStation|PSVR|Vita)/i },
  { label: 'Xbox', match: /^(XBOX|X360|XONE|Series X)/i },
  { label: 'Nintendo', match: /^(Switch|Wii|NES|SNES|N64|GB|GBA|NDS|3DS|GameCube|NGC)/i },
  { label: 'Mobile', match: /^(iOS|Android|iPad|iPhone)/i },
  { label: 'Mac', match: /^Mac/i },
  { label: 'Linux', match: /^Linux/i },
]

export const GAME_PLATFORMS: string[] = PLATFORM_FAMILIES.map((family) => family.label)

export function platformFamilies(platforms: string[]): string[] {
  const found = new Set<string>()
  const unmatched: string[] = []

  for (const platform of platforms) {
    const family = PLATFORM_FAMILIES.find((candidate) => candidate.match.test(platform))
    if (family) found.add(family.label)
    else if (!unmatched.includes(platform)) unmatched.push(platform)
  }

  return [
    ...PLATFORM_FAMILIES.filter((family) => found.has(family.label)).map((family) => family.label),
    ...unmatched,
  ]
}

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
  first_release_date?: number
  summary?: string | null
  cover?: IgdbImage
  screenshots?: IgdbImage[]
  genres?: { name: string }[]
  game_modes?: { name: string }[]
  involved_companies?: { developer?: boolean; company?: { name?: string } }[]
  platforms?: { name?: string; abbreviation?: string }[]
  total_rating_count?: number
}

interface IgdbTimeToBeat {
  game_id: number
  normally?: number
  hastily?: number
  completely?: number
}

// IGDB has no static key: the Twitch id/secret are exchanged for a ~56-day
// bearer token, cached here and renewed on demand.
let cachedToken: { value: string; expiresAt: number } | null = null

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
// caller inherits it. `nextSlot` advances synchronously, so two callers can't be
// handed the same slot. Divided by machine count: each process enforces a share.
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

// IGDB's game_modes vocabulary (/v4/game_modes) has no "versus" mode, and its
// plain "Multiplayer" means "more than one player", not "competitive" — It Takes
// Two and Stardew Valley carry it alongside "Co-operative". So Multiplayer only
// counts as versus when Co-operative is absent: a game with both under-tags as
// coop rather than misleading someone filtering for versus.
const SINGLEPLAYER_MODE = 'Single player'
const MULTIPLAYER_MODE = 'Multiplayer'
const COOP_MODE = 'Co-operative'
const OTHER_MULTIPLAYER_MODES = ['Split screen', 'Massively Multiplayer Online (MMO)', 'Battle Royale']

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
    tags: [
      ...(game.genres ?? []).map((genre) => genre.name.toLowerCase()),
      ...derivePlayerTags(game.game_modes),
    ],
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

async function hoursToBeatFor(gameIds: number[]): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map()

  const rows = await igdbQuery<IgdbTimeToBeat>(
    'game_time_to_beats',
    `fields game_id,normally,hastily,completely; where game_id = (${gameIds.join(',')}); limit ${gameIds.length};`,
  )

  const hours = new Map<number, number>()
  for (const row of rows) {
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

// Numeric id or slug. Either way external_id comes from the response, so a slug
// never reaches the database.
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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Pulls a game reference out of whatever someone pasted — a page URL, or a bare
// numeric id. The character class keeps quotes out of the APICalypse literal
// built from it.
export function parseIgdbId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  const slug = trimmed.match(/igdb\.com\/games\/([a-z0-9-]+)/i)
  if (slug) return slug[1].toLowerCase()

  const apiId = trimmed.match(/api\.igdb\.com\/v\d+\/games\/(\d+)/i)
  return apiId ? apiId[1] : null
}
