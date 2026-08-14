import type { Db } from './db.ts'
import { CONSUMPTION_STATUSES, loadUserLogEntries, matchesLogFilter, type listUserMediaLog } from './mediaItems.ts'
import { getTasteProfile } from './recommendations/tasteProfile.ts'
import { ACTIVE_MEDIA_TYPES, type ActiveMediaType } from '../mediaTypes.ts'

export interface MediaTypeSummary {
  summary: string
  // Surfaced because profiles are only refreshed when the log has moved, so
  // generating a run no longer implies the profile is current.
  profileUpdatedAt: number | null
  log: Awaited<ReturnType<typeof listUserMediaLog>>
  total: number
}

export type MediaSummaries = Record<ActiveMediaType, MediaTypeSummary>

// One entry per wired-up media type, so the profile and users pages don't each
// hand-roll a fetch per type. Adding a type to ACTIVE_MEDIA_TYPES populates
// both for free.
export async function loadMediaSummaries(db: Db, userId: number, recentCount: number): Promise<MediaSummaries> {
  // Fetched once and partitioned in memory: per-type list+count calls would be
  // one pass over identical rows per media type.
  const [logEntries, profiles] = await Promise.all([
    loadUserLogEntries(db, userId),
    Promise.all(ACTIVE_MEDIA_TYPES.map((type) => getTasteProfile(db, userId, type))),
  ])

  const entries = ACTIVE_MEDIA_TYPES.map((type, index) => {
    // Declined items are left out of both the list and the count: this feeds
    // the "What I've watched" sections, and a rejection isn't something you've
    // watched. They're still browsable in full at /profile/watched, and they
    // still reach the taste profile, which reads the log directly.
    const forType = logEntries.filter((entry) =>
      matchesLogFilter(entry, { type, statuses: CONSUMPTION_STATUSES }),
    )
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
