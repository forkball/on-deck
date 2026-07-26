import type { Db } from './db.ts'
import { userTasteProfiles, type UserTasteProfile } from './schema.ts'

export interface TasteProfileData {
  liked_tags: string[]
  disliked_tags: string[]
}

export function parseProfile(row: UserTasteProfile | null): TasteProfileData {
  if (!row) return { liked_tags: [], disliked_tags: [] }

  try {
    const parsed = JSON.parse(row.profile) as Partial<TasteProfileData>
    return {
      liked_tags: Array.isArray(parsed.liked_tags) ? parsed.liked_tags : [],
      disliked_tags: Array.isArray(parsed.disliked_tags) ? parsed.disliked_tags : [],
    }
  } catch {
    return { liked_tags: [], disliked_tags: [] }
  }
}

export async function getTasteProfile(db: Db, userId: number) {
  return db.findOne(userTasteProfiles, { where: { user_id: userId } })
}

export interface UpsertTasteProfileInput extends TasteProfileData {
  summary: string
}

export async function upsertTasteProfile(
  db: Db,
  userId: number,
  data: UpsertTasteProfileInput,
): Promise<UserTasteProfile> {
  const existing = await getTasteProfile(db, userId)
  const payload = {
    profile: JSON.stringify({ liked_tags: data.liked_tags, disliked_tags: data.disliked_tags }),
    summary: data.summary,
    updated_at: Date.now(),
  }

  if (existing) {
    await db.updateMany(userTasteProfiles, payload, { where: { user_id: userId } })
    return (await getTasteProfile(db, userId))!
  }

  return db.create(userTasteProfiles, { user_id: userId, ...payload }, { returnRow: true })
}
