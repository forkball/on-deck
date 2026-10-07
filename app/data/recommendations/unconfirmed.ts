import { inList } from 'remix/data-table'

import type { Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import { unconfirmedRuns, type UnconfirmedRun } from '../schema.ts'
import { titlesNameSameWork } from '../titles.ts'
import type { ExcludedTitles, Pick, RecommendationFilters } from './picks.ts'

// Its own ceiling rather than the runs one. It happens to be the same number, but
// these answer a different question — how many failed attempts are worth keeping
// around to read — and moving one shouldn't move the other.
export const MAX_UNCONFIRMED_PER_USER = 3

// Which of the model's picks an unconfirmed run keeps.
//
// The catalog is down, so nothing here has a catalog id and the id filter that
// normally keeps a logged title out of a run has nothing to compare. The logs are
// in our own database, though, so the run's exclusion list is still to hand and
// the titles are compared instead — the same fallback the unmatched picks on an
// ordinary run use.
//
// A lucky draw promises one pick, and asks for a dozen only so the gates have
// something to drop; its answer is the top-ranked pick that survives this, not
// the whole list.
export function picksToKeepUnconfirmed(
  picks: Pick[],
  options: { lucky: boolean; excluded: ExcludedTitles },
): Pick[] {
  const ruledOut = [...options.excluded.seen, ...options.excluded.rejected]
  const kept = picks.filter((pick) => !ruledOut.some((title) => titlesNameSameWork(pick.title, title)))
  return options.lucky ? kept.slice(0, 1) : kept
}

export interface UnconfirmedRunDetail {
  id: number
  mediaType: MediaType
  filters: RecommendationFilters
  picks: Pick[]
  reason: string
  createdAt: number
  // A lucky draw: one pick, shown the way a lucky run shows its pick.
  isLucky: boolean
}

// A malformed row reads as empty rather than throwing on a page someone is already
// having a bad time on.
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// The columns are text holding the model's own JSON.
function parse(row: UnconfirmedRun): UnconfirmedRunDetail {
  return {
    id: row.id,
    mediaType: row.media_type as MediaType,
    filters: parseJson<RecommendationFilters>(row.params, {}),
    picks: parseJson<Pick[]>(row.picks, []),
    reason: row.reason,
    createdAt: Number(row.created_at),
    isLucky: row.is_lucky === true,
  }
}

export async function saveUnconfirmedRun(
  db: Db,
  input: {
    userId: number
    mediaType: MediaType
    filters: RecommendationFilters
    picks: Pick[]
    reason: string
    lucky?: boolean
  },
): Promise<number> {
  const row = await db.create(
    unconfirmedRuns,
    {
      user_id: input.userId,
      media_type: input.mediaType,
      params: JSON.stringify(input.filters),
      picks: JSON.stringify(input.picks),
      reason: input.reason,
      created_at: Date.now(),
      is_lucky: input.lucky === true,
    },
    { returnRow: true },
  )

  await pruneOldUnconfirmedRuns(db, input.userId)
  return row.id
}

// Oldest first out the door, newest kept — the opposite order to how they're read.
async function pruneOldUnconfirmedRuns(db: Db, userId: number): Promise<void> {
  const rows = await db.findMany(unconfirmedRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
  })
  if (rows.length <= MAX_UNCONFIRMED_PER_USER) return

  const excess = rows.slice(MAX_UNCONFIRMED_PER_USER)
  await db.deleteMany(unconfirmedRuns, {
    where: inList(
      'id',
      excess.map((row) => row.id),
    ),
  })
}

export async function listUnconfirmedRuns(db: Db, userId: number): Promise<UnconfirmedRunDetail[]> {
  const rows = await db.findMany(unconfirmedRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
    limit: MAX_UNCONFIRMED_PER_USER,
  })

  return rows.map(parse)
}

// Scoped to the reader: these are one person's unanswered attempt, and there is no
// sharing story for a list nothing has confirmed.
export async function getUnconfirmedRun(
  db: Db,
  id: number,
  userId: number,
): Promise<UnconfirmedRunDetail | null> {
  const row = await db.findOne(unconfirmedRuns, { where: { id, user_id: userId } })
  return row ? parse(row) : null
}
