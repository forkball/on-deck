import type { Db } from './db.ts'
import { loadUserLogEntries, type listUserMediaLog } from './mediaItems.ts'
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
  // Fetched once and partitioned in memory: per-type list+count calls meant six
  // passes over identical rows, which is what made this slow as logs grew.
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
