import type { Db } from './db.ts'
import { loadUserLogEntries, type listUserMediaLog } from './mediaCatalog.ts'
import { getTasteProfile } from './tasteProfile.ts'
import { ACTIVE_MEDIA_TYPES, type ActiveMediaType } from '../utils/mediaTypes.ts'

export interface MediaTypeSummary {
  summary: string
  // When the taste profile was last written, or null if there isn't one yet.
  // Surfaced because profiles are no longer rewritten on every run — they're
  // only refreshed when the log has moved, so how current one is stops being
  // obvious from the fact that you just generated something.
  profileUpdatedAt: number | null
  log: Awaited<ReturnType<typeof listUserMediaLog>>
  total: number
}

export type MediaSummaries = Record<ActiveMediaType, MediaTypeSummary>

// One entry per wired-up media type: taste-profile blurb, a capped recent
// log, and the full count behind it.
//
// Exists so the profile and users pages don't each hand-roll a fetch per
// type — they previously carried six near-identical props and had to be
// edited in lockstep, which is exactly how a third type ends up half-wired.
// Adding a type to ACTIVE_MEDIA_TYPES now populates both pages for free.
export async function loadMediaSummaries(db: Db, userId: number, recentCount: number): Promise<MediaSummaries> {
  // The whole log is fetched once and partitioned in memory. Calling
  // listUserMediaLog + countUserMediaLog per type would re-read the same rows
  // twice per media type — six passes over identical data for what one pass
  // answers — and that redundancy is what made the profile page slow as logs
  // grew.
  const [logEntries, profiles] = await Promise.all([
    loadUserLogEntries(db, userId),
    Promise.all(ACTIVE_MEDIA_TYPES.map((type) => getTasteProfile(db, userId, type))),
  ])

  const entries = ACTIVE_MEDIA_TYPES.map((type, index) => {
    const forType = logEntries.filter(({ item }) => item?.type === type)
    return [
      type,
      {
        summary: profiles[index]?.summary ?? '',
        profileUpdatedAt: profiles[index] ? Number(profiles[index]!.updated_at) : null,
        log: forType.slice(0, recentCount),
        total: forType.length,
      },
    ] as const
  })

  return Object.fromEntries(entries) as MediaSummaries
}
