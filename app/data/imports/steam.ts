import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import { runBounded } from './csv.ts'
import { IGDB_MAX_CONCURRENCY } from '../catalog/igdb.ts'
import type { Db } from '../db.ts'
import { logInteraction, type LogInteractionInput } from '../mediaItems.ts'
import { fetchSteamLibrary, type SteamGame } from './steamApi.ts'

export interface SteamImportResult {
  totalGames: number
  skipped: number
  imported: number
  played: number
  unplayed: number
  notFound: string[]
}

// One catalog search per game — IGDB has no bulk or by-appid endpoint. Lower
// than the CSV importers' bound because IGDB serves only 4 requests/second.
const CONCURRENCY = IGDB_MAX_CONCURRENCY

const NOT_A_GAME =
  /\b(soundtrack|ost|demo|playtest|beta|dedicated server|sdk|benchmark|artbook|art book|season pass|dlc|editor|mod tools|trailer|wallpaper)\b/i

const EDITION_SUFFIX =
  /\b(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|special|anniversary|legendary|collection|gold|platinum|premium|classic|directors cut)\b.*$/

const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/

export async function importSteamLibrary(db: Db, userId: number, steamId: string): Promise<SteamImportResult> {
  const outcome = await fetchSteamLibrary(steamId)
  if (!outcome.ok) throw new Error(outcome.message)

  const games = outcome.games
  const playable = games.filter((game) => !NOT_A_GAME.test(game.name))

  const notFound: string[] = []

  // Keyed by resolved catalog game, not Steam entry: Steam lists the same game
  // twice ("Arkham Asylum" and "… GOTY Edition") and both resolve to one IGDB
  // game. Per-entry writes let the last one win, so playtime on one edition and
  // none on the other reads as never played. Summed instead.
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
      // Omitted, not null: Steam has no notion of a rating, so re-importing a
      // library must leave any rating already given here alone rather than
      // clearing it.
      notes: null,
      // Steam knows how long, never when, so this stays unset.
    })

    if (status === 'consumed') played++
    else unplayed++
  })

  return {
    totalGames: games.length,
    skipped: games.length - playable.length,
    imported: merged.size,
    played,
    unplayed,
    notFound,
  }
}

// Stricter than the Goodreads importer's `matches[0]`: Steam gives the exact
// published name, so anything short of a title match is more likely wrong than
// lucky — and a wrong game silently poisons the taste profile.
async function matchGame(steamName: string): Promise<CatalogSearchResult | null> {
  // Searched separately rather than re-filtering the first result set: a query
  // like "Painkiller: Gold" doesn't return plain "Painkiller" at all.
  for (const query of searchVariants(steamName)) {
    const results = await getCatalogProvider('game').search(query)
    const wanted = normalizeTitle(query)

    const exact = results.find((result) => normalizeTitle(result.title) === wanted)
    if (exact) return exact
  }

  return null
}

function searchVariants(steamName: string): string[] {
  const variants = [steamName]

  const withoutYear = steamName.replace(TRAILING_PARENTHETICAL, '').trim()
  if (withoutYear && withoutYear !== steamName) variants.push(withoutYear)

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
