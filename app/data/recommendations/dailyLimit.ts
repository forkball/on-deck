import { and, eq, gte, lt } from 'remix/data-table'

import type { Db } from '../db.ts'
import { profileRebuildUsage, recommendationRunUsage, type User } from '../schema.ts'

// Generating is the one thing a person can do here that spends money on their
// behalf: every run is several model calls plus a fan-out of catalog requests.
// The queue bounds how much of that runs at once — one job per user, two slots
// per machine (see jobs.ts, worker.ts); this bounds how much one account can buy
// over a day.
export const RUNS_PER_DAY = 5

// A group run costs more to produce than a solo one, and the difference grows
// with the group: the picks call weighs every candidate against every profile,
// so the reasoning scales with how many people are in it.
//
// Half the headcount, rounded up, so a pair still costs what one person does and
// each additional couple adds a slot: 4 people spend 2 of the day's runs, 6
// spend 3, 10 spend 5.
export function runCostFor(memberCount: number): number {
  return Math.max(1, Math.ceil(memberCount / 2))
}

// Rolling, not a calendar day: a midnight reset is 10 runs in the twenty minutes
// around it, and lands at a different local time for everyone.
export const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface DailyRunsUsed {
  unlimited: false
  limit: number
  used: number
  remaining: number
  // When the oldest run in the window ages out and a slot comes back. Null
  // until something has been used.
  resetsAt: number | null
}

// Admins are exempt rather than generously capped — the cap exists to stop one
// account running away with the bill.
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

// Spent when a run is saved, not when one is queued: a run that dies partway
// produced nothing, and charging for it would make an outage cost someone their
// day. Only one job per user is ever in flight (hasActiveJob), so at most one
// uncounted run exists at a time.
//
// `cost` is booked as that many rows rather than a quantity on one, so
// everything reading this ledger keeps counting rows — the allowance, the sweep,
// and the oldest-row timestamp that says when a slot comes back.
export async function recordRunAgainstDailyLimit(db: Db, userId: number, cost = 1): Promise<void> {
  const now = Date.now()
  for (let i = 0; i < cost; i++) {
    await db.create(recommendationRunUsage, { user_id: userId, created_at: now })
  }

  // Rows outside the window can never change an answer again. Swept on write
  // rather than on a timer, for the reason the job sweep is (see jobs.ts): an
  // idle machine should schedule nothing.
  await db.deleteMany(recommendationRunUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

// A model call someone can ask for whenever they like, so it needs its own
// ceiling — a day of tuning your profile shouldn't cost you the runs it was for.
export const PROFILE_REBUILDS_PER_DAY = 5

export async function getProfileRebuildAllowance(db: Db, user: User): Promise<DailyRunAllowance> {
  // Exempt for the same reason as above — whoever runs the app has to be able
  // to exercise this without tripping over a limit meant for the bill.
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

// Charged when asked for, not when it lands — unlike a run. The cost here is the
// model call, and a rebuild that fails has already made it.
export async function recordProfileRebuild(db: Db, userId: number): Promise<void> {
  const now = Date.now()
  await db.create(profileRebuildUsage, { user_id: userId, created_at: now })

  await db.deleteMany(profileRebuildUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

// Relative, because the server's clock is UTC and "you can generate again at
// 02:00" is wrong for nearly everyone. Rounded up, so the wait is never short.
export function timeUntil(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((timestamp - now) / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.ceil(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
