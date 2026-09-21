import type { Db } from './db.ts'
import {
  CONSUMPTION_STATUSES,
  loadUserLogEntries,
  matchesLogFilter,
  type listUserMediaLog,
} from './mediaItems.ts'
import { getTasteProfile } from './recommendations/tasteProfile.ts'
import { ACTIVE_MEDIA_TYPES, type ActiveMediaType } from '../mediaTypes.ts'

export interface MediaTypeSummary {
  summary: string
  profileUpdatedAt: number | null
  log: Awaited<ReturnType<typeof listUserMediaLog>>
  total: number
}

export type MediaSummaries = Record<ActiveMediaType, MediaTypeSummary>

export async function loadMediaSummaries(
  db: Db,
  userId: number,
  recentCount: number,
): Promise<MediaSummaries> {
  // Fetched once and partitioned in memory: per-type list+count calls would be
  // one pass over identical rows per media type.
  const [logEntries, profiles] = await Promise.all([
    loadUserLogEntries(db, userId),
    Promise.all(ACTIVE_MEDIA_TYPES.map((type) => getTasteProfile(db, userId, type))),
  ])

  const entries = ACTIVE_MEDIA_TYPES.map((type, index) => {
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
