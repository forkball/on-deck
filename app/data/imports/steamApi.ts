// Steam account linking via OpenID 2.0, plus reading a linked account's
// owned games.
//
// Two different mechanisms with two different purposes, easy to conflate:
//
//  - OpenID proves identity and needs no key. It returns exactly one thing —
//    the SteamID64 — and grants no access to anything.
//  - The Web API key reads that account's library. It authenticates *this
//    app* to Steam, not the person, and confers no privileges: Steam still
//    enforces the profile's own privacy settings, so a private profile
//    returns nothing however valid the key is.
const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const STEAM_API_BASE = 'https://api.steampowered.com'

// Steam returns the identity as a URL; the SteamID64 is the last segment.
const CLAIMED_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

// Where Steam sends people to sign in. `realm` is the origin it will return
// to and must match `returnTo`, so both are derived from the live request
// rather than configured — the app runs on localhost in development and on
// Fly in production, and hardcoding either would break the other.
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

// Verifies a callback and returns the SteamID64, or null.
//
// The callback is a plain GET the browser was redirected to, so every
// parameter in it is attacker-supplied — including the claimed id. Trusting
// it directly would let anyone link any Steam account by typing a URL. The
// only thing that makes it trustworthy is handing the parameters straight
// back to Steam with mode=check_authentication and letting Steam confirm it
// signed them; a forged or replayed assertion answers `is_valid:false`.
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

export interface SteamGame {
  appId: number
  name: string
  // Total minutes played, ever. Zero means owned but never launched, which
  // is what lets an import set a status rather than guess one.
  playtimeMinutes: number
}

export type SteamLibraryOutcome =
  | { ok: true; games: SteamGame[] }
  | { ok: false; reason: 'private' | 'unavailable'; message: string }

interface OwnedGamesResponse {
  response?: { game_count?: number; games?: { appid: number; name?: string; playtime_forever?: number }[] }
}

// Reads a linked account's owned games.
//
// A private profile is indistinguishable from an empty one in the payload —
// Steam returns `{"response":{}}` either way rather than an error — so this
// reports it as its own outcome instead of silently importing zero games and
// looking like it worked.
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
