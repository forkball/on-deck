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

// One catalog search per game — there's no bulk endpoint and no Steam-appid
// lookup, so a large library is a lot of requests. Lower than the CSV
// importers' bound because IGDB serves 4 requests/second and will start
// refusing above that; a large import is correspondingly slower.
const CONCURRENCY = IGDB_MAX_CONCURRENCY

// Steam libraries carry things that aren't games and would be nonsense in a
// tracker: soundtracks, demos, server binaries, editors. IGDB would either
// miss them or match the parent game and log it twice.
const NOT_A_GAME =
  /\b(soundtrack|ost|demo|playtest|beta|dedicated server|sdk|benchmark|artbook|art book|season pass|dlc|editor|mod tools|trailer|wallpaper)\b/i

// Edition wording Steam puts in a name but IGDB usually doesn't. Only tried
// after the full name fails, so "Skyrim Special Edition" still wins when
// IGDB does list it separately.
const EDITION_SUFFIX =
  /\b(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|special|anniversary|legendary|collection|gold|platinum|premium|classic|directors cut)\b.*$/

// Steam disambiguates re-releases in parentheses — "Mass Effect (2007)",
// "Mafia II (Classic)", "Riven (1997)" — where IGDB carries the plain name.
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/

// Imports a linked Steam account's owned games.
//
// Unlike the CSV importers the source is an API call, which changes two
// things: the failure modes are Steam's rather than a malformed file, and
// every entry carries `playtime_forever` — so status is derived rather than
// assumed. Never launched means it's on the pile; any playtime at all means
// it's been played.
//
// Games resolve through IGDB rather than being stored as Steam rows, so the
// same game found by search and by import is one catalog entry, not two.
export async function importSteamLibrary(db: Db, userId: number, steamId: string): Promise<SteamImportResult> {
  const outcome = await fetchSteamLibrary(steamId)
  // The message is already written for a person to read — a private profile
  // is the common case and says what to change.
  if (!outcome.ok) throw new Error(outcome.message)

  const games = outcome.games
  const playable = games.filter((game) => !NOT_A_GAME.test(game.name))

  const notFound: string[] = []

  // Keyed by the resolved catalog game, not by Steam entry. Steam frequently
  // lists the same game twice — "Batman: Arkham Asylum" alongside "Batman:
  // Arkham Asylum GOTY Edition" — and both resolve here to one IGDB game.
  // Writing per Steam entry meant the last one processed won, so a library
  // with 964 minutes on the GOTY edition and 0 on the plain listing could
  // import as never played. Playtime is summed instead: any time on any
  // edition means you've played it.
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
      // Steam knows how long, never when — `rtime_last_played` is only on
      // recently played games — so this stays unset rather than guessing.
    })

    if (status === 'consumed') played++
    else unplayed++
  })

  return {
    totalGames: games.length,
    skipped: games.length - playable.length,
    // Distinct games, which is why this can be lower than the number of
    // Steam entries matched.
    imported: merged.size,
    played,
    unplayed,
    notFound,
  }
}

// Resolves a Steam name to an IGDB game, or nothing.
//
// Deliberately stricter than the Goodreads importer's `matches[0]`. That one
// is guessing from a title and author with no better option; here Steam gives
// the exact published name, so anything short of a title match is more likely
// a wrong game than a lucky one — and a wrong game silently poisons the taste
// profile. Unmatched titles get reported instead.
async function matchGame(steamName: string): Promise<CatalogSearchResult | null> {
  // Each variant is searched separately rather than re-filtering the first
  // set of results. Measured on a 1,125-game library: searching only the full
  // name left 127 unmatched on RAWG, because a query like "Painkiller: Gold"
  // doesn't return plain "Painkiller" at all — the base game has to be asked
  // for by name. Re-querying recovered 16 of them, Mass Effect and System
  // Shock 2 among them.
  for (const query of searchVariants(steamName)) {
    const results = await getCatalogProvider('game').search(query)
    const wanted = normalizeTitle(query)

    const exact = results.find((result) => normalizeTitle(result.title) === wanted)
    if (exact) return exact
  }

  return null
}

// Progressively less specific names to ask IGDB for. Only the first is tried
// for the vast majority of games; the rest cost an extra request each, and
// only on titles that would otherwise be reported as unmatched.
function searchVariants(steamName: string): string[] {
  const variants = [steamName]

  const withoutYear = steamName.replace(TRAILING_PARENTHETICAL, '').trim()
  if (withoutYear && withoutYear !== steamName) variants.push(withoutYear)

  // Normalized rather than raw, since the edition wording is matched against
  // normalized text — punctuation between the title and the suffix varies.
  const normalized = normalizeTitle(withoutYear)
  const base = normalized.replace(EDITION_SUFFIX, '').trim()
  if (base && base !== normalized) variants.push(base)

  return variants
}

// Trademark symbols and punctuation differ constantly between the two
// catalogues — "Sid Meier's Civilization® VI" against "Sid Meier's
// Civilization VI" — so comparison happens on letters and digits only.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
