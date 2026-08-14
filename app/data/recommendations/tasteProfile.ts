import { createHash } from 'node:crypto'

import { requestStructured } from './claude.ts'
import type { Db } from '../db.ts'
import { listUserMediaLog, type MediaType } from '../mediaItems.ts'
import { userTasteProfiles, type UserTasteProfile } from '../schema.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'

export interface TasteProfileData {
  liked_tags: string[]
  disliked_tags: string[]
}

// What the profile is written from. Held on the user rather than passed per
// call, so the answer is the same wherever a profile gets rebuilt.
export interface TasteProfileSettings {
  // How many of the most recent entries reach the prompt. Null is all of them
  // — the behaviour every profile had before this was a choice.
  logLimit: number | null
  // Whether the notes someone wrote on their own entries are sent. They're the
  // richest thing in the log and the most personal, which is the whole reason
  // it's a question.
  useNotes: boolean
}

// Null last, since "everything" is the end of a scale rather than an option
// alongside the numbers.
export const PROFILE_LOG_LIMITS: readonly (number | null)[] = [10, 50, 100, null]

export function profileSettingsFor(user: {
  profile_log_limit: number | null
  profile_use_notes: boolean
}): TasteProfileSettings {
  return { logLimit: user.profile_log_limit, useNotes: user.profile_use_notes }
}

// Anything not on the list would be a number nobody could have chosen through
// the form, so it's read as the default rather than trusted.
export function parseProfileLogLimit(raw: string): number | null {
  const parsed = Number(raw)
  return PROFILE_LOG_LIMITS.includes(parsed) ? parsed : null
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

// The rows the prompt is actually built from, which is not the whole log once
// someone has narrowed it. Kept separate from the log itself because callers
// need the log entire — exclusions have to know about everything you've seen,
// not just the slice your profile was written from.
//
// The slice takes the head because the log arrives most recent first
// (updated_at desc, see loadUserLogEntries).
export function profilePromptRows(log: LogEntry[], settings: TasteProfileSettings) {
  const scoped = settings.logLimit == null ? log : log.slice(0, settings.logLimit)

  return scoped.map(({ interaction, item }) => ({
    title: item?.title ?? 'Unknown title',
    status: interaction.status,
    rating: interaction.rating,
    disliked: interaction.disliked,
    // Left out entirely rather than sent as null: a column of nulls reads as
    // "this person never writes anything down", which is a claim about them
    // rather than about what they chose to share.
    ...(settings.useNotes ? { notes: interaction.notes } : {}),
  }))
}

// Everything the model is given, built from rows the settings have already
// filtered. The settings are applied here in code and never described to the
// model: it isn't told a limit exists, isn't asked to ignore anything, and
// can't be relied on to. What someone excluded simply isn't in the request.
//
// Exported so that can be checked rather than taken on trust — a test can read
// the whole string and confirm the withheld text appears nowhere in it.
export function buildProfilePrompt(
  loggedItems: ReturnType<typeof profilePromptRows>,
  mediaType: MediaType,
  settings: TasteProfileSettings,
): string {
  const noun = mediaTypeUiFor(mediaType).singular
  // Has to match what was actually sent, or it promises notes that aren't
  // there and invites the model to wonder where they went.
  const fields = settings.useNotes
    ? `status, rating out of 5, whether they disliked it, and any notes they left`
    : `status, rating out of 5, and whether they disliked it`
  // Order is information the log has always carried and the prompt never
  // mentioned, which left the model reading a sequence as a pile. It matters
  // more now that a limit can make this the recent part of a longer history.
  //
  // That there is more further back is said plainly, because the alternative
  // is worse: shown ten entries and told nothing, the model reads ten as the
  // whole of someone's taste. Saying a thing exists is not the same as
  // sending it — no excluded title, rating or note appears here.
  const ordering =
    settings.logLimit == null
      ? `They're listed most recently updated first.`
      : `These are their ${loggedItems.length} most recently updated, listed newest first — ` +
        `they may well have logged more further back. Weigh the recent ones as the better guide ` +
        `to where their taste is now.`

  return (
    `Here is a person's ${noun} log (${fields}). ${ordering}\n` +
    `${JSON.stringify(loggedItems, null, 2)}\n\n` +
    `Write a short (2-4 sentence) natural-language summary of their taste, grounded only ` +
    `in what's above — no invented facts. Also derive liked_tags and disliked_tags: short, ` +
    `lowercase genre/mood/style tags (e.g. "slow-burn", "dystopian", "feel-good") inferred ` +
    `from what they rated highly vs. poorly. A "not_interested" status is one they turned ` +
    `down without trying — a dislike signal in its own right, carrying no rating. ` +
    `A null rating on any other status means they simply never rated it: infer nothing ` +
    `about whether they liked it, and never treat it as a low score. Ratings run 0.5 to 5, ` +
    `so the bottom of the scale is 0.5, not 0. "disliked": true is the third answer to that ` +
    `same question: they finished it, didn't like it, and declined to put a number on ` +
    `it. Treat it as a firm dislike — it never carries a rating, and its absence of one ` +
    `is a refusal to score rather than a low score.`
  )
}

// The sole write path for a profile. Returns the log it was built from too, so
// callers that need it (to exclude already-seen titles) don't re-fetch — the
// whole log, not the slice, for the reason above.
export async function regenerateTasteProfile(
  db: Db,
  userId: number,
  mediaType: MediaType,
  settings: TasteProfileSettings,
): Promise<RegeneratedTasteProfile> {
  const log = await listUserMediaLog(db, userId, { type: mediaType })
  const loggedItems = profilePromptRows(log, settings)

  if (loggedItems.length === 0) {
    const empty = { summary: '', liked_tags: [], disliked_tags: [] }
    // Signed like any other, or an empty log reads as stale on every run.
    await upsertTasteProfile(db, userId, mediaType, {
      ...empty,
      logSignature: logSignature(log, settings),
    })
    return { ...empty, log }
  }

  const parsed = await requestStructured<UpsertTasteProfileInput>('profile.model', {
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PROFILE_SCHEMA },
    },
    messages: [{ role: 'user', content: buildProfilePrompt(loggedItems, mediaType, settings) }],
  })

  await upsertTasteProfile(db, userId, mediaType, { ...parsed, logSignature: logSignature(log, settings) })
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
//
// The settings belong in here for the same reason the rows do: they decide
// what the prompt contains. Left out, narrowing the log or turning notes off
// would leave the stored profile looking current, and the setting would appear
// to do nothing — which reads as a broken feature rather than a stale cache.
//
// Signed over the sliced rows, not the whole log, which falls out of the same
// rule: an entry beyond someone's limit never reaches the prompt, so changing
// it can't change the answer and shouldn't buy a model call.
export function logSignature(log: LogEntry[], settings: TasteProfileSettings): string {
  const scoped = settings.logLimit == null ? log : log.slice(0, settings.logLimit)

  const rows = scoped
    .map(({ interaction, item }) =>
      [
        item?.id ?? 0,
        item?.title ?? '',
        interaction.status,
        interaction.rating ?? '',
        interaction.disliked ?? '',
        // Only when they're sent. Off, an edited note can't change the prompt.
        settings.useNotes ? (interaction.notes ?? '') : '',
      ].join('\u0001'),
    )
    .sort()
    .join('\u0002')

  const preamble = [settings.logLimit ?? 'all', settings.useNotes ? 'notes' : 'no-notes'].join(':')

  return createHash('sha1').update(`${preamble}|${rows}`).digest('hex')
}

// Profiles written before signatures existed report undefined, so they read as
// stale and regenerate once.
function isProfileStale(
  profile: UserTasteProfile | null,
  log: LogEntry[],
  settings: TasteProfileSettings,
): boolean {
  if (!profile) return true
  return parseStoredProfile(profile).logSignature !== logSignature(log, settings)
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
  settings: TasteProfileSettings,
): Promise<EnsuredTasteProfile> {
  const [profile, log] = await Promise.all([
    getTasteProfile(db, userId, mediaType),
    listUserMediaLog(db, userId, { type: mediaType }),
  ])

  if (!isProfileStale(profile, log, settings)) {
    const stored = parseStoredProfile(profile!)
    return {
      summary: profile!.summary,
      liked_tags: stored.liked_tags,
      disliked_tags: stored.disliked_tags,
      log,
      regenerated: false,
    }
  }

  return { ...(await regenerateTasteProfile(db, userId, mediaType, settings)), regenerated: true }
}
