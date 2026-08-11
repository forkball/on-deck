import { createHash } from 'node:crypto'

import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from '../db.ts'
import { listUserMediaLog, type MediaType } from '../mediaItems.ts'
import { userTasteProfiles, type UserTasteProfile } from '../schema.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'

export interface TasteProfileData {
  liked_tags: string[]
  disliked_tags: string[]
}

export async function getTasteProfile(db: Db, userId: number, mediaType: MediaType) {
  return db.findOne(userTasteProfiles, { where: { user_id: userId, media_type: mediaType } })
}

export interface UpsertTasteProfileInput extends TasteProfileData {
  summary: string
  // Fingerprint of the log this was written from. Inside the existing JSON blob
  // rather than a new column, which keeps it migration-free.
  logSignature?: string
}

export async function upsertTasteProfile(
  db: Db,
  userId: number,
  mediaType: MediaType,
  data: UpsertTasteProfileInput,
): Promise<UserTasteProfile> {
  const existing = await getTasteProfile(db, userId, mediaType)
  const payload = {
    profile: JSON.stringify({
      liked_tags: data.liked_tags,
      disliked_tags: data.disliked_tags,
      logSignature: data.logSignature ?? '',
    }),
    summary: data.summary,
    updated_at: Date.now(),
  }

  if (existing) {
    await db.updateMany(userTasteProfiles, payload, { where: { user_id: userId, media_type: mediaType } })
    return (await getTasteProfile(db, userId, mediaType))!
  }

  return db.create(userTasteProfiles, { user_id: userId, media_type: mediaType, ...payload }, { returnRow: true })
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
  log: Awaited<ReturnType<typeof listUserMediaLog>>
}

// The sole write path for a profile. Returns the log it was built from too, so
// callers that need it (to exclude already-seen titles) don't re-fetch.
export async function regenerateTasteProfile(
  db: Db,
  userId: number,
  mediaType: MediaType,
): Promise<RegeneratedTasteProfile> {
  const log = await listUserMediaLog(db, userId, { type: mediaType })

  if (log.length === 0) {
    const empty = { summary: '', liked_tags: [], disliked_tags: [] }
    // Signed like any other, or an empty log reads as stale on every run.
    await upsertTasteProfile(db, userId, mediaType, { ...empty, logSignature: logSignature(log) })
    return { ...empty, log }
  }

  const noun = mediaTypeUiFor(mediaType).singular
  const loggedItems = log.map(({ interaction, item }) => ({
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
          `Here is a person's ${noun} log (status, rating out of 5, and any notes they left):\n` +
          `${JSON.stringify(loggedItems, null, 2)}\n\n` +
          `Write a short (2-4 sentence) natural-language summary of their taste, grounded only ` +
          `in what's above — no invented facts. Also derive liked_tags and disliked_tags: short, ` +
          `lowercase genre/mood/style tags (e.g. "slow-burn", "dystopian", "feel-good") inferred ` +
          `from what they rated highly vs. poorly. A "not_interested" status is one they turned ` +
          `down without trying — a dislike signal in its own right, carrying no rating. ` +
          `A null rating on any other status means they simply never rated it: infer nothing ` +
          `about whether they liked it, and never treat it as a low score. Ratings run 0.5 to 5, ` +
          `so the bottom of the scale is 0.5, not 0.`,
      },
    ],
  })

  const parsed = parseStructuredResponse<UpsertTasteProfileInput>(response)
  await upsertTasteProfile(db, userId, mediaType, { ...parsed, logSignature: logSignature(log) })
  return { ...parsed, log }
}

interface StoredProfile extends TasteProfileData {
  logSignature?: string
}

function parseStoredProfile(profile: UserTasteProfile): StoredProfile {
  try {
    const parsed = JSON.parse(profile.profile) as Partial<StoredProfile>
    return {
      liked_tags: parsed.liked_tags ?? [],
      disliked_tags: parsed.disliked_tags ?? [],
      logSignature: parsed.logSignature,
    }
  } catch {
    return { liked_tags: [], disliked_tags: [] }
  }
}

type LogEntry = Awaited<ReturnType<typeof listUserMediaLog>>[number]

// Exactly the fields the prompt is built from, and nothing else: if this is
// unchanged the model would see a byte-identical prompt, so the stored profile
// is still the right answer.
//
// Timestamps and a row count aren't enough — rematching a title rewrites what
// the model reads while every interaction row stays as it was. Sorted, so row
// order can't register as a change.
function logSignature(log: LogEntry[]): string {
  const rows = log
    .map(({ interaction, item }) =>
      [
        item?.id ?? 0,
        item?.title ?? '',
        interaction.status,
        interaction.rating ?? '',
        interaction.notes ?? '',
      ].join('\u0001'),
    )
    .sort()
    .join('\u0002')

  return createHash('sha1').update(rows).digest('hex')
}

// Profiles written before signatures existed report undefined, so they read as
// stale and regenerate once.
function isProfileStale(profile: UserTasteProfile | null, log: LogEntry[]): boolean {
  if (!profile) return true
  return parseStoredProfile(profile).logSignature !== logSignature(log)
}

export interface EnsuredTasteProfile extends RegeneratedTasteProfile {
  // False when the stored profile was reused.
  regenerated: boolean
}

// Regenerating costs a model call per member per source type, so the stored
// profile is returned untouched unless the log has actually moved. The log
// itself is always read — it's a plain query the caller needs anyway.
export async function ensureTasteProfile(
  db: Db,
  userId: number,
  mediaType: MediaType,
): Promise<EnsuredTasteProfile> {
  const [profile, log] = await Promise.all([
    getTasteProfile(db, userId, mediaType),
    listUserMediaLog(db, userId, { type: mediaType }),
  ])

  if (!isProfileStale(profile, log)) {
    const stored = parseStoredProfile(profile!)
    return {
      summary: profile!.summary,
      liked_tags: stored.liked_tags,
      disliked_tags: stored.disliked_tags,
      log,
      regenerated: false,
    }
  }

  return { ...(await regenerateTasteProfile(db, userId, mediaType)), regenerated: true }
}
