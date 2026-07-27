import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from './db.ts'
import { listUserMovieLog } from './movies.ts'
import { userTasteProfiles, type UserTasteProfile } from './schema.ts'

export interface TasteProfileData {
  liked_tags: string[]
  disliked_tags: string[]
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

const PROFILE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    summary: { type: 'string' as const },
    liked_tags: { type: 'array' as const, items: { type: 'string' as const } },
    disliked_tags: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['summary', 'liked_tags', 'disliked_tags'],
}

export interface RegeneratedTasteProfile extends UpsertTasteProfileInput {
  log: Awaited<ReturnType<typeof listUserMovieLog>>
}

// Regenerates the taste profile from the user's movie log via Claude, persists
// it, and returns the fresh value (plus the log it was built from, so callers
// that also need the log — e.g. to compute already-seen titles — don't have
// to re-fetch it). The sole write path for the profile now that manual
// editing is gone. See app/data/recommendations.ts, which calls this before
// generating picks.
export async function regenerateTasteProfile(db: Db, userId: number): Promise<RegeneratedTasteProfile> {
  const log = await listUserMovieLog(db, userId)

  if (log.length === 0) {
    const empty = { summary: '', liked_tags: [], disliked_tags: [] }
    await upsertTasteProfile(db, userId, empty)
    return { ...empty, log }
  }

  const loggedMovies = log.map(({ interaction, item }) => ({
    title: item?.title ?? 'Unknown title',
    status: interaction.status,
    rating: interaction.rating,
    notes: interaction.notes,
  }))

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PROFILE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `Here is a person's movie log (status, rating out of 5, and any notes they left):\n` +
          `${JSON.stringify(loggedMovies, null, 2)}\n\n` +
          `Write a short (2-4 sentence) natural-language summary of their taste, grounded only ` +
          `in what's above — no invented facts. Also derive liked_tags and disliked_tags: short, ` +
          `lowercase genre/mood/style tags (e.g. "slow-burn", "dystopian", "feel-good") inferred ` +
          `from what they rated highly vs. poorly.`,
      },
    ],
  })

  const parsed = parseStructuredResponse<UpsertTasteProfileInput>(response)
  await upsertTasteProfile(db, userId, parsed)
  return { ...parsed, log }
}
