import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import { runBounded } from './csv.ts'
import { IGDB_MAX_CONCURRENCY } from '../catalog/igdb.ts'
import type { Db } from '../db.ts'
import { logInteraction, type LogInteractionInput } from '../mediaItems.ts'
import { fetchSteamLibrary, type SteamGame } from './steamApi.ts'

export interface SteamImportResult {
  // Everything Steam returned, before filtering.
  totalGames: number
  // Entries that aren't games (soundtracks, demos, dedicated servers).
  skipped: number
  imported: number
  played: number
  unplayed: number
  // Titles IGDB had no confident match for.
  notFound: string[]
}

// One catalog search per game — IGDB has no bulk or by-appid endpoint. Lower
// than the CSV importers' bound because IGDB serves only 4 requests/second.
const CONCURRENCY = IGDB_MAX_CONCURRENCY

// Soundtracks, demos, server binaries, editors. IGDB would either miss these or
// match the parent game and log it twice.
const NOT_A_GAME =
  /\b(soundtrack|ost|demo|playtest|beta|dedicated server|sdk|benchmark|artbook|art book|season pass|dlc|editor|mod tools|trailer|wallpaper)\b/i

// Only tried after the full name fails, so "Skyrim Special Edition" still wins
// where IGDB lists it separately.
const EDITION_SUFFIX =
  /\b(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|special|anniversary|legendary|collection|gold|platinum|premium|classic|directors cut)\b.*$/

// Steam disambiguates re-releases in parentheses ("Mass Effect (2007)") where
// IGDB carries the plain name.
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/

// Every entry carries `playtime_forever`, so status is derived rather than
// assumed: never launched means it's on the pile, any playtime means played.
//
// Games resolve through IGDB rather than being stored as Steam rows, so one
// game found by search and by import is a single catalog entry.
export async function importSteamLibrary(db: Db, userId: number, steamId: string): Promise<SteamImportResult> {
  const outcome = await fetchSteamLibrary(steamId)
  // Already written for a person to read.
  if (!outcome.ok) throw new Error(outcome.message)

  const games = outcome.games
  const playable = games.filter((game) => !NOT_A_GAME.test(game.name))

  const notFound: string[] = []

  // Keyed by resolved catalog game, not Steam entry: Steam lists the same game
  // twice ("Arkham Asylum" and "Arkham Asylum GOTY Edition") and both resolve
  // to one IGDB game. Per-entry writes let the last one win, so 964 minutes on
  // one edition and 0 on the other imported as never played. Playtime is summed.
  const merged = new Map<string, { match: CatalogSearchResult; playtimeMinutes: number }>()

  await runBounded(playable, CONCURRENCY, async (game) => {
    const match = await matchGame(game.name)
    if (!match) {
      notFound.push(game.name)
      return
    }

    const existing = merged.get(match.externalId)
    if (existing) existing.playtimeMinutes += game.playtimeMinutes
    else merged.set(match.externalId, { match, playtimeMinutes: game.playtimeMinutes })
  })

  let played = 0
  let unplayed = 0

  await runBounded([...merged.values()], CONCURRENCY, async ({ match, playtimeMinutes }) => {
    const status: LogInteractionInput['status'] = playtimeMinutes > 0 ? 'consumed' : 'want_to_consume'

    const item = await upsertCatalogItem(db, 'game', match)
    await logInteraction(db, userId, item.id, {
      status,
      rating: null,
      notes: null,
      // Steam knows how long, never when, so this stays unset.
    })

    if (status === 'consumed') played++
    else unplayed++
  })

  return {
    totalGames: games.length,
    skipped: games.length - playable.length,
    // Distinct games, so lower than the number of Steam entries matched.
    imported: merged.size,
    played,
    unplayed,
    notFound,
  }
}

// Stricter than the Goodreads importer's `matches[0]`: Steam gives the exact
// published name, so anything short of a title match is more likely a wrong
// game than a lucky one — and a wrong game silently poisons the taste profile.
async function matchGame(steamName: string): Promise<CatalogSearchResult | null> {
  // Searched separately rather than re-filtering the first result set: a query
  // like "Painkiller: Gold" doesn't return plain "Painkiller" at all. On a
  // 1,125-game library this recovered 16 of 127 unmatched titles.
  for (const query of searchVariants(steamName)) {
    const results = await getCatalogProvider('game').search(query)
    const wanted = normalizeTitle(query)

    const exact = results.find((result) => normalizeTitle(result.title) === wanted)
    if (exact) return exact
  }

  return null
}

// Progressively less specific. The rest cost an extra request each, and are
// only reached by titles that would otherwise be reported unmatched.
function searchVariants(steamName: string): string[] {
  const variants = [steamName]

  const withoutYear = steamName.replace(TRAILING_PARENTHETICAL, '').trim()
  if (withoutYear && withoutYear !== steamName) variants.push(withoutYear)

  // Normalized, since punctuation between title and suffix varies.
  const normalized = normalizeTitle(withoutYear)
  const base = normalized.replace(EDITION_SUFFIX, '').trim()
  if (base && base !== normalized) variants.push(base)

  return variants
}

// Trademark symbols and punctuation differ constantly between the two catalogues
// ("Sid Meier's Civilization® VI"), so compare on letters and digits only.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
