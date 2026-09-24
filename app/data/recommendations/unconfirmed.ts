import type { Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import { unconfirmedRuns, type UnconfirmedRun } from '../schema.ts'
import type { Pick, RecommendationFilters } from './picks.ts'

// The same ceiling recommendation_runs keeps, for the same reason: these are a
// record of one attempt, not a library.
export const MAX_UNCONFIRMED_PER_USER = 3

export interface UnconfirmedRunDetail {
  id: number
  mediaType: MediaType
  filters: RecommendationFilters
  picks: Pick[]
  reason: string
  createdAt: number
}

// The columns are text holding the model's own JSON. Parsed here so a malformed
// row reads as an empty list rather than throwing on a page someone is already
// having a bad time on.
function parse(row: UnconfirmedRun): UnconfirmedRunDetail {
  const safely = <T>(raw: string, fallback: T): T => {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  return {
    id: row.id,
    mediaType: row.media_type as MediaType,
    filters: safely<RecommendationFilters>(row.params, {}),
    picks: safely<Pick[]>(row.picks, []),
    reason: row.reason,
    createdAt: Number(row.created_at),
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
    },
    { returnRow: true },
  )

  await pruneOldUnconfirmedRuns(db, input.userId)
  return row.id
}

// Oldest first out the door, newest kept — the opposite order to how they're read.
export async function pruneOldUnconfirmedRuns(db: Db, userId: number): Promise<void> {
  const rows = await db.findMany(unconfirmedRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
  })

  for (const row of rows.slice(MAX_UNCONFIRMED_PER_USER)) {
    await db.delete(unconfirmedRuns, row.id)
  }
}

export async function listUnconfirmedRuns(db: Db, userId: number): Promise<UnconfirmedRunDetail[]> {
  const rows = await db.findMany(unconfirmedRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
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
