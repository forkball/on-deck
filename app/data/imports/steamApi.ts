// Two mechanisms, easy to conflate: OpenID proves identity, needs no key, and
// returns only the SteamID64. The Web API key reads the library — it
// authenticates this app, not the person, and Steam still enforces the
// profile's own privacy settings.
const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const STEAM_API_BASE = 'https://api.steampowered.com'

// Steam returns the identity as a URL; the SteamID64 is the last segment.
const CLAIMED_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

// `realm` must match `returnTo`, and both are derived from the live request:
// the app runs on localhost in development and Fly in production.
export function buildSteamLoginUrl(realm: string, returnTo: string): string {
  const url = new URL(OPENID_ENDPOINT)
  url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0')
  url.searchParams.set('openid.mode', 'checkid_setup')
  url.searchParams.set('openid.return_to', returnTo)
  url.searchParams.set('openid.realm', realm)
  // Steam only supports identifier_select — it decides which account.
  url.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select')
  url.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select')
  return url.toString()
}

// The callback is a plain GET, so every parameter including the claimed id is
// attacker-supplied — trusting it would let anyone link any account by typing a
// URL. Only Steam confirming it signed them (mode=check_authentication) makes
// it trustworthy; a forged or replayed assertion answers `is_valid:false`.
export async function verifySteamCallback(params: URLSearchParams): Promise<string | null> {
  const claimedId = params.get('openid.claimed_id')
  if (!claimedId) return null

  const verification = new URLSearchParams(params)
  verification.set('openid.mode', 'check_authentication')

  const response = await fetch(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: verification.toString(),
  })
  if (!response.ok) return null

  // The response is key:value lines, not JSON.
  const body = await response.text()
  const valid = body.split('\n').some((line) => line.trim() === 'is_valid:true')
  if (!valid) return null

  // Only trust the id *after* Steam vouches for the signature over it.
  const match = claimedId.match(CLAIMED_ID_PATTERN)
  return match ? match[1] : null
}

interface PlayerSummariesResponse {
  response?: { players?: { steamid?: string; personaname?: string }[] }
}

// The display name Steam shows for an account, so a connection can be named
// rather than numbered. OpenID hands back only the SteamID64 — nobody knows
// their own — and a member looking at their settings is asking "is this the
// right account", which seventeen digits cannot answer.
//
// Null on every failure, deliberately and quietly: this is decoration over an
// id that already works, so a missing key, a rate limit or a private profile
// costs the nicer label and nothing else. Every caller falls back to the number.
export async function fetchSteamPersona(steamId: string): Promise<string | null> {
  const key = process.env.STEAM_API_KEY
  if (!key) return null

  const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`)
  url.searchParams.set('key', key)
  url.searchParams.set('steamids', steamId)

  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const data = (await response.json()) as PlayerSummariesResponse
    // Asked for one id, but the endpoint answers in a list and omits accounts
    // it won't talk about rather than returning a blank entry.
    const name = data.response?.players?.find((player) => player.steamid === steamId)?.personaname
    return name?.trim() || null
  } catch {
    return null
  }
}

export interface SteamGame {
  appId: number
  name: string
  // Zero means owned but never launched, which is what lets an import derive
  // a status.
  playtimeMinutes: number
}

export type SteamLibraryOutcome =
  | { ok: true; games: SteamGame[] }
  | { ok: false; reason: 'private' | 'unavailable'; message: string }

interface OwnedGamesResponse {
  response?: { game_count?: number; games?: { appid: number; name?: string; playtime_forever?: number }[] }
}

// Steam returns `{"response":{}}` for both a private profile and an empty one,
// so this reports privacy as its own outcome rather than silently importing
// zero games and looking like it worked.
export async function fetchSteamLibrary(steamId: string): Promise<SteamLibraryOutcome> {
  const key = process.env.STEAM_API_KEY
  if (!key) {
    return { ok: false, reason: 'unavailable', message: 'Steam importing isn\'t configured on this server.' }
  }

  const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`)
  url.searchParams.set('key', key)
  url.searchParams.set('steamid', steamId)
  url.searchParams.set('include_appinfo', '1')
  url.searchParams.set('include_played_free_games', '1')

  const response = await fetch(url)
  if (!response.ok) {
    return { ok: false, reason: 'unavailable', message: `Steam returned ${response.status}. Try again shortly.` }
  }

  const data = (await response.json()) as OwnedGamesResponse
  const games = data.response?.games

  if (!games) {
    return {
      ok: false,
      reason: 'private',
      message:
        'Steam returned nothing for that account. Set your profile\'s "Game details" to Public in Steam privacy settings, then try again.',
    }
  }

  return {
    ok: true,
    games: games
      .filter((game) => game.name)
      .map((game) => ({
        appId: game.appid,
        name: game.name!,
        playtimeMinutes: game.playtime_forever ?? 0,
      })),
  }
}
