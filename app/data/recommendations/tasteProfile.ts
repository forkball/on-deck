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

export interface TasteProfileSettings {
  logLimit: number | null
  useNotes: boolean
}

export const PROFILE_LOG_LIMITS: readonly (number | null)[] = [10, 50, 100, null]

export function profileSettingsFor(user: {
  profile_log_limit: number | null
  profile_use_notes: boolean
}): TasteProfileSettings {
  return { logLimit: user.profile_log_limit, useNotes: user.profile_use_notes }
}

// Anything off the list couldn't have come from the form — read as the default
// rather than trusted.
export function parseProfileLogLimit(raw: string): number | null {
  const parsed = Number(raw)
  return PROFILE_LOG_LIMITS.includes(parsed) ? parsed : null
}

export async function getTasteProfile(db: Db, userId: number, mediaType: MediaType) {
  return db.findOne(userTasteProfiles, { where: { user_id: userId, media_type: mediaType } })
}

export interface UpsertTasteProfileInput extends TasteProfileData {
  summary: string
  // Fingerprint of the log this was written from, inside the existing JSON blob.
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

// Not the whole log once someone has narrowed it. Callers still need the log
// entire — exclusions have to know everything you've seen. Takes the head
// because the log arrives most recent first (updated_at desc).
export function profilePromptRows(log: LogEntry[], settings: TasteProfileSettings) {
  const scoped = settings.logLimit == null ? log : log.slice(0, settings.logLimit)

  return scoped.map(({ interaction, item }) => ({
    title: item?.title ?? 'Unknown title',
    status: interaction.status,
    rating: interaction.rating,
    disliked: interaction.disliked,
    // Left out entirely rather than sent as null — a column of nulls is a claim
    // about the person rather than about what they chose to share.
    ...(settings.useNotes ? { notes: interaction.notes } : {}),
  }))
}

// The settings are applied in code and never described to the model: what
// someone excluded is absent from the request, not something the model is asked
// to ignore. Exported so a test can confirm the withheld text appears nowhere.
export function buildProfilePrompt(
  loggedItems: ReturnType<typeof profilePromptRows>,
  mediaType: MediaType,
  settings: TasteProfileSettings,
): string {
  const noun = mediaTypeUiFor(mediaType).singular
  // Has to match what was actually sent, or it promises notes that aren't there.
  const fields = settings.useNotes
    ? `status, rating out of 5, whether they disliked it, and any notes they left`
    : `status, rating out of 5, and whether they disliked it`
  // Under a limit this says there is more further back, or the model takes ten
  // entries for the whole of someone's taste. Saying a thing exists is not
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

// Returns the whole log, not the slice, so callers excluding already-seen titles
// don't re-fetch.
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
    await upsertTasteProfile(db, userId, mediaType, {
      ...empty,
      logSignature: logSignature(log, settings),
    })
    return { ...empty, log }
  }

  const parsed = await requestStructured<UpsertTasteProfileInput>('profile.model', {
    model: 'claude-sonnet-5',
    // Shared with the reasoning, which is what fills a budget here: the output
    // is small and fixed, but the thinking grows with the log it reads.
    max_tokens: 8000,
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

// Exactly the fields the prompt is built from, and nothing else. Timestamps and
// a row count aren't enough — rematching a title rewrites what the model reads
// while every interaction row stays as it was. Sorted, so row order can't
// register as a change. Covers the settings too, since they decide what the
// prompt contains.
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
        settings.useNotes ? (interaction.notes ?? '') : '',
      ].join('\u0001'),
    )
    .sort()
    .join('\u0002')

  const preamble = [settings.logLimit ?? 'all', settings.useNotes ? 'notes' : 'no-notes'].join(':')

  return createHash('sha1').update(`${preamble}|${rows}`).digest('hex')
}

function isProfileStale(
  profile: UserTasteProfile | null,
  log: LogEntry[],
  settings: TasteProfileSettings,
): boolean {
  if (!profile) return true
  return parseStoredProfile(profile).logSignature !== logSignature(log, settings)
}

export interface EnsuredTasteProfile extends RegeneratedTasteProfile {
  regenerated: boolean
}

// Regenerating costs a model call per member per source type.
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
