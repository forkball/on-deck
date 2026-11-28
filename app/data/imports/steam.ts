// The Steam-specific rules of a Steam library import, free of the database and
// the network so they are tested directly. Fetching the library is steamApi's
// job, staging it is batches', and matching it is matcher's — which asks this
// module how a Steam row is matched and what happens when two of them turn out
// to be one game.

import type { CandidateLike } from './classify.ts'
import type { ParsedRow } from './batches.ts'
import type { StagedRow } from './review.ts'
import type { SteamGame } from './steamApi.ts'
import type { CatalogQuery } from '../catalog/query.ts'
import { normalizeTitle } from '../titles.ts'

const NOT_A_GAME =
  /\b(soundtrack|ost|demo|playtest|beta|dedicated server|sdk|benchmark|artbook|art book|season pass|dlc|editor|mod tools|trailer|wallpaper)\b/i

const EDITION_SUFFIX =
  /\b(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|special|anniversary|legendary|collection|gold|platinum|premium|classic|directors cut)\b.*$/

const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/

// The statuses an import stages; not_interested is never one.
type LogStatus = StagedRow['logStatus']

// A library as rows to stage. Non-games are dropped here rather than staged and
// skipped: a soundtrack is not a question review should ask, and Steam lists
// dozens of them in a large library.
//
// The status is decided now, from playtime: anything launched is played, the
// rest is owned-but-unstarted. Steam knows how long, never when, and has no
// rating or note — all left null, which saving reads as "leave what is logged".
// No year either: Steam's library doesn't carry one, which is why a Steam batch
// is matched by exact title rather than by year (see matchSteamTitle).
export function steamRows(games: SteamGame[]): ParsedRow[] {
  return games
    .filter((game) => !NOT_A_GAME.test(game.name))
    .map((game, index) => ({
      // 1-based like a file's line numbers, which is how review names a row.
      rowIndex: index + 1,
      title: game.name,
      year: null,
      rating: null,
      consumedAt: null,
      logStatus: game.playtimeMinutes > 0 ? 'consumed' : 'want_to_consume',
    }))
}

// Stricter than the file importers' nearest-year fallback: Steam gives the exact
// published name, so anything short of a title match is more likely wrong than
// lucky — and a wrong game silently poisons the taste profile. No match is
// `not_found`, which review then offers to search for by hand.
//
// Searched separately per variant rather than re-filtering the first result
// set: a query like "Painkiller: Gold" doesn't return plain "Painkiller" at all.
export async function matchSteamTitle<Result extends CandidateLike>(
  steamName: string,
  search: (query: CatalogQuery) => Promise<Result[]>,
): Promise<Result | null> {
  for (const query of searchVariants(steamName)) {
    const results = await search({ title: query })
    const wanted = normalizeTitle(query)

    const exact = results.find((result) => normalizeTitle(result.title) === wanted)
    if (exact) return exact
  }

  return null
}

export function searchVariants(steamName: string): string[] {
  const variants = [steamName]

  const withoutYear = steamName.replace(TRAILING_PARENTHETICAL, '').trim()
  if (withoutYear && withoutYear !== steamName) variants.push(withoutYear)

  // Trademark symbols and punctuation differ constantly between the two catalogues
  // ("Sid Meier's Civilization® VI"), which is what the shared rule levels out.
  const normalized = normalizeTitle(withoutYear)
  const base = normalized.replace(EDITION_SUFFIX, '').trim()
  if (base && base !== normalized) variants.push(base)

  return variants
}

export interface EditionRow {
  id: number
  rowIndex: number
  state: string
  mediaItemId: number | null
  logStatus: LogStatus
}

export interface EditionMerge {
  // The row kept for each game, where merging changed its status.
  restatus: { id: number; logStatus: LogStatus }[]
  // The other editions, folded into the row kept.
  drop: number[]
}

const STATUS_RANK: Record<LogStatus, number> = { want_to_consume: 0, in_progress: 1, consumed: 2 }

// Steam lists one game several times ("Arkham Asylum" and "… GOTY Edition"),
// and every listing resolves to the same catalog game. For a file import two
// rows on one entry is a question — a rewatch, or a mis-match — but here it is
// one game owned twice, so the editions are folded into one row before review
// sees them, rather than shown as duplicate cards nobody could answer
// differently.
//
// Their playtime is summed, and the status follows the sum: played if any
// edition was launched. Since a row's status already records whether its own
// playtime was above zero, the sum is above zero exactly when one of them is
// played, which is why no minutes need staging.
//
// The row kept is one the member answered by hand, if any (a remembered answer
// from an earlier import), else the first listed.
export function planEditionMerge(rows: EditionRow[]): EditionMerge {
  const byItem = new Map<number, EditionRow[]>()
  for (const row of rows) {
    if (row.mediaItemId == null || row.state === 'not_found' || row.state === 'skipped') continue
    const group = byItem.get(row.mediaItemId)
    if (group) group.push(row)
    else byItem.set(row.mediaItemId, [row])
  }

  const merge: EditionMerge = { restatus: [], drop: [] }

  for (const group of byItem.values()) {
    if (group.length < 2) continue

    const [keep, ...rest] = [...group].sort(
      (a, b) => Number(b.state === 'confirmed') - Number(a.state === 'confirmed') || a.rowIndex - b.rowIndex,
    )
    const status = group.reduce<LogStatus>(
      (best, row) => (STATUS_RANK[row.logStatus] > STATUS_RANK[best] ? row.logStatus : best),
      keep!.logStatus,
    )

    if (status !== keep!.logStatus) merge.restatus.push({ id: keep!.id, logStatus: status })
    merge.drop.push(...rest.map((row) => row.id))
  }

  return merge
}
