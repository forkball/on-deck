import { and, eq, gte, lt } from 'remix/data-table'

import type { Db } from '../db.ts'
import { profileRebuildUsage, recommendationRunUsage, type User } from '../schema.ts'

// Generating is the one thing a person can do here that spends money on their
// behalf: every run is several model calls plus a fan-out of catalog requests.
// The queue already bounds how much of that runs at once — one job per user,
// two slots per machine (see jobs.ts, worker.ts) — but nothing bounded how much
// of it a single account could buy over a day. This does.
export const RUNS_PER_DAY = 5

// Rolling, not a calendar day. A midnight reset is 10 runs in the ten minutes
// either side of it, and it lands at a different local time for everyone, so
// "you're out until tomorrow" would be a lie for most of the people reading it.
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

// Admins are exempt rather than generously capped: the cap is there to stop one
// account running away with the bill, and whoever is running the app needs to
// be able to exercise generation without tripping it.
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

// Spent when a run is saved, not when one is queued: a run that dies partway —
// a model timeout, a machine going away mid-generation — produced nothing, and
// charging for it would make an outage cost the person their day's runs.
//
// Attempts can't be banked against that, either. Only one job per user is ever
// in flight (hasActiveJob), so at most one uncounted run exists at a time, and
// the check below it happens before that job is queued.
export async function recordRunAgainstDailyLimit(db: Db, userId: number): Promise<void> {
  const now = Date.now()
  await db.create(recommendationRunUsage, { user_id: userId, created_at: now })

  // Rows outside the window can never change an answer again. Swept on write
  // rather than on a timer, for the reason the job sweep is (see jobs.ts): an
  // idle machine should schedule nothing.
  await db.deleteMany(recommendationRunUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

// Rebuilding a taste profile by hand is a model call someone can ask for
// whenever they like, so it needs its own ceiling. Separate from the run cap
// rather than sharing it: they're different sizes of spend, and a day of
// tuning your profile shouldn't cost you the recommendations it was for.
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

// Spent when the rebuild is asked for, not when it lands — unlike a run, which
// is charged on save. The difference is deliberate: the cost here is the model
// call, and a rebuild that fails has already made it.
export async function recordProfileRebuild(db: Db, userId: number): Promise<void> {
  const now = Date.now()
  await db.create(profileRebuildUsage, { user_id: userId, created_at: now })

  await db.deleteMany(profileRebuildUsage, {
    where: and(eq('user_id', userId), lt('created_at', now - LIMIT_WINDOW_MS)),
  })
}

// Relative, because this is rendered on the server and the server's clock is
// UTC — "you can generate again at 02:00" is wrong for nearly everyone reading
// it. Rounded up, so the wait is never shorter than promised.
export function timeUntil(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((timestamp - now) / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.ceil(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
