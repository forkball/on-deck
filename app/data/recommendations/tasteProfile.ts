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
  // Fingerprint of the log this profile was written from — see logSignature.
  // Lives inside the existing JSON blob rather than a new column, which keeps
  // this migration-free.
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

// Regenerates the taste profile from the user's log (scoped to one media
// type — see the media_type column on user_taste_profiles) via Claude,
// persists it, and returns the fresh value (plus the log it was built from,
// so callers that also need the log — e.g. to compute already-seen titles —
// don't have to re-fetch it). The sole write path for the profile now that
// manual editing is gone. See generate.ts, which calls this
// before generating picks.
export async function regenerateTasteProfile(
  db: Db,
  userId: number,
  mediaType: MediaType,
): Promise<RegeneratedTasteProfile> {
  const log = await listUserMediaLog(db, userId, { type: mediaType })

  if (log.length === 0) {
    const empty = { summary: '', liked_tags: [], disliked_tags: [] }
    // Signed like any other, or an empty log would read as stale on every
    // run and rewrite this row forever.
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
          `from what they rated highly vs. poorly.`,
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

// A fingerprint of everything about the log that reaches the model.
//
// Deliberately the exact fields the prompt is built from, and nothing else:
// if this is unchanged the model would be handed a byte-identical prompt, so
// the profile it produced is still the right answer. That equivalence is the
// whole point — it makes "has anything changed?" answerable without deciding,
// case by case, which kinds of change matter.
//
// Timestamps and a row count were the first attempt and were not enough. They
// see additions, edits and deletions, but not a change to the item a log
// points at: rematching a title rewrites what the model reads while every
// interaction row, and every timestamp on it, stays exactly as it was. They
// also quietly assume every write bumps updated_at, which is a property of
// code elsewhere rather than anything guaranteed here.
//
// Sorted, so the order rows come back in can't register as a change.
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

// Whether the log has moved since the profile was written.
//
// Profiles written before signatures existed report undefined, which reads as
// stale and regenerates once, filling it in.
function isProfileStale(profile: UserTasteProfile | null, log: LogEntry[]): boolean {
  if (!profile) return true
  return parseStoredProfile(profile).logSignature !== logSignature(log)
}

export interface EnsuredTasteProfile extends RegeneratedTasteProfile {
  // False when the stored profile was reused — the caller can report how much
  // work it actually did.
  regenerated: boolean
}

// The profile a recommendation run should use.
//
// Regenerating is a model call per member per source type, and a run repeats
// it every single time even when nothing has been logged since — so the same
// answer gets paid for again. This returns the stored profile untouched
// unless the log has actually moved.
//
// The log itself is always read: it's a plain query, and the caller needs it
// to exclude things already logged from the picks.
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
