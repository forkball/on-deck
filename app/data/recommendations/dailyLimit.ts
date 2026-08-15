import { and, eq, gte, lt } from 'remix/data-table'

import type { Db } from '../db.ts'
import { profileRebuildUsage, recommendationRunUsage, type User } from '../schema.ts'

export const RUNS_PER_DAY = 5

export function runCostFor(memberCount: number): number {
  return Math.max(1, Math.ceil(memberCount / 2))
}

export const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface DailyRunsUsed {
  unlimited: false
  limit: number
  used: number
  remaining: number
  resetsAt: number | null
}

export type DailyRunAllowance = { unlimited: true } | DailyRunsUsed

export async function getDailyRunAllowance(db: Db, user: User): Promise<DailyRunAllowance> {
  if (user.is_admin) return { unlimited: true }

  const rows = await db.findMany(recommendationRunUsage, {
    where: and(eq('user_id', user.id), gte('created_at', Date.now() - LIMIT_WINDOW_MS)),
    orderBy: ['created_at', 'asc'],
  })

  return {
    unlimited: false,
    limit: RUNS_PER_DAY,
    used: rows.length,
    remaining: Math.max(0, RUNS_PER_DAY - rows.length),
    resetsAt: rows.length > 0 ? Number(rows[0].created_at) + LIMIT_WINDOW_MS : null,
  }
}

// `cost` is booked as that many rows rather than a quantity on one: the
// allowance, the sweep and the resetsAt timestamp all count rows.
export async function recordRunAgainstDailyLimit(db: Db, userId: number, cost = 1): Promise<void> {
  const now = Date.now()
  for (let i = 0; i < cost; i++) {
    await db.create(recommendationRunUsage, { user_id: userId, created_at: now })
  }

  await db.deleteMany(recommendationRunUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

export const PROFILE_REBUILDS_PER_DAY = 5

export async function getProfileRebuildAllowance(db: Db, user: User): Promise<DailyRunAllowance> {
  if (user.is_admin) return { unlimited: true }

  const rows = await db.findMany(profileRebuildUsage, {
    where: and(eq('user_id', user.id), gte('created_at', Date.now() - LIMIT_WINDOW_MS)),
    orderBy: ['created_at', 'asc'],
  })

  return {
    unlimited: false,
    limit: PROFILE_REBUILDS_PER_DAY,
    used: rows.length,
    remaining: Math.max(0, PROFILE_REBUILDS_PER_DAY - rows.length),
    resetsAt: rows.length > 0 ? Number(rows[0].created_at) + LIMIT_WINDOW_MS : null,
  }
}

export async function recordProfileRebuild(db: Db, userId: number): Promise<void> {
  const now = Date.now()
  await db.create(profileRebuildUsage, { user_id: userId, created_at: now })

  await db.deleteMany(profileRebuildUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

// Relative: the server's clock is UTC, so an absolute time would be wrong for
// nearly everyone reading it.
export function timeUntil(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((timestamp - now) / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.ceil(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
