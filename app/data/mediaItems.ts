import { and, eq, inList } from 'remix/data-table'

import { parseMediaMetadata, type MediaMetadata } from './mediaMetadata.ts'

import { pool, type Db } from './db.ts'
import {
  INTERACTION_STATUSES,
  mediaItems,
  userMediaInteractions,
  type MediaItem,
  type UserMediaInteraction,
} from './schema.ts'
import type { TmdbSearchResult } from './catalog/tmdb.ts'
import { displayLabel } from './users.ts'

export type MediaType = MediaItem['type']

// `previous` makes this a merge, not an overwrite: a search payload carries no
// credits, runtime or description, so re-importing over an enriched row would
// null out what a by-id lookup filled in. Rematch passes none — it repoints the
// row at a different work.
function buildMetadata(result: TmdbSearchResult, previous?: unknown, fromDetailLookup = false): MediaMetadata {
  const prev = previous != null ? parseMediaMetadata(previous) : null

  return {
    enrichedAt: fromDetailLookup ? Date.now() : (prev?.enrichedAt ?? null),
    releaseYear: result.releaseYear ?? prev?.releaseYear ?? null,
    posterUrl: result.posterUrl ?? prev?.posterUrl ?? null,
    overview: result.overview ?? prev?.overview ?? null,
    runtimeMinutes: result.runtimeMinutes ?? prev?.runtimeMinutes ?? null,
    pageCount: result.pageCount ?? prev?.pageCount ?? null,
    playtimeHours: result.playtimeHours ?? prev?.playtimeHours ?? null,
    seasonCount: result.seasonCount ?? prev?.seasonCount ?? null,
    creator: result.creator ?? prev?.creator ?? null,
    // `??` won't do: an empty array is truthy, so a lookup returning no stills
    // would replace a set we already had.
    images: result.images?.length ? result.images : (prev?.images ?? []),
    platforms: result.platforms?.length ? result.platforms : (prev?.platforms ?? []),
    tags: result.tags?.length ? result.tags : (prev?.tags ?? []),
  }
}

export async function upsertMediaItem(
  db: Db,
  type: MediaType,
  result: TmdbSearchResult,
  source: string,
  fromDetailLookup = false,
): Promise<MediaItem> {
  const existing = await db.findOne(mediaItems, {
    where: { type, external_source: source, external_id: result.externalId },
  })

  const metadata = buildMetadata(result, existing?.metadata, fromDetailLookup)

  const item = existing
    ? await db.update(mediaItems, existing.id, { metadata, popularity_score: result.popularity })
    : await db.create(
        mediaItems,
        {
          type,
          external_source: source,
          external_id: result.externalId,
          title: result.title,
          metadata,
          popularity_score: result.popularity,
          created_at: Date.now(),
        },
        { returnRow: true },
      )

  return item
}

// For a detail lookup that 404'd — without the stamp the row re-requests on
// every view forever.
export async function markMediaItemEnriched(db: Db, item: MediaItem): Promise<void> {
  const metadata = parseMediaMetadata(item.metadata)
  await db.update(mediaItems, item.id, { metadata: { ...metadata, enrichedAt: Date.now() } })
}

export type RematchMediaItemResult = { ok: true; item: MediaItem; merged: boolean } | { ok: false; error: string }

// The unique (user_id, media_item_id) constraint won't allow keeping both logs,
// so the more recently updated wins.
async function mergeInteractionsInto(db: Db, fromMediaItemId: number, toMediaItemId: number): Promise<void> {
  const interactions = await db.findMany(userMediaInteractions, { where: { media_item_id: fromMediaItemId } })

  for (const interaction of interactions) {
    const existingOnTarget = await db.findOne(userMediaInteractions, {
      where: { user_id: interaction.user_id, media_item_id: toMediaItemId },
    })

    if (!existingOnTarget) {
      await db.update(userMediaInteractions, interaction.id, { media_item_id: toMediaItemId })
    } else if (interaction.updated_at > existingOnTarget.updated_at) {
      await db.delete(userMediaInteractions, existingOnTarget.id)
      await db.update(userMediaInteractions, interaction.id, { media_item_id: toMediaItemId })
    }
    // else: the target's log is newer — leave it to be cascade-deleted.
  }
}

// In place, so interactions stay attached to the same id. Tags are fully
// replaced — the old ones described the wrong work.
export async function rematchMediaItem(
  db: Db,
  type: MediaType,
  mediaItemId: number,
  externalId: string,
  lookupById: (externalId: string) => Promise<TmdbSearchResult | null>,
  source: string,
  lookupFailedError: string,
): Promise<RematchMediaItemResult> {
  const existing = await db.find(mediaItems, mediaItemId)
  if (!existing) return { ok: false, error: 'Not found.' }

  if (existing.external_source === source && existing.external_id === externalId) {
    return { ok: false, error: "That's already the match." }
  }

  const collision = await db.findOne(mediaItems, {
    where: { type, external_source: source, external_id: externalId },
  })
  if (collision) {
    await mergeInteractionsInto(db, mediaItemId, collision.id)
    await db.delete(mediaItems, mediaItemId)
    return { ok: true, item: collision, merged: true }
  }

  const result = await lookupById(externalId)
  if (!result) return { ok: false, error: lookupFailedError }

  const metadata = buildMetadata(result, undefined, true)

  const item = await db.update(mediaItems, mediaItemId, {
    external_source: source,
    external_id: result.externalId,
    title: result.title,
    metadata,
    popularity_score: result.popularity,
  })

  return { ok: true, item, merged: false }
}

export type InteractionStatus = (typeof INTERACTION_STATUSES)[number]

// Derived rather than listed again, so a status added later is included by
// default — only another kind of refusal needs excluding here.
export const CONSUMPTION_STATUSES: readonly InteractionStatus[] = INTERACTION_STATUSES.filter(
  (status) => status !== 'not_interested',
)

export interface UserLogEntry {
  interaction: UserMediaInteraction
  item: MediaItem | null
}

export interface LogInteractionInput {
  status: InteractionStatus
  // Three states, not two. `undefined` leaves whatever is already stored alone;
  // `null` is the user saying "no rating" and clears it. Importers pass
  // `undefined` for a row they know nothing about, so re-running an import can't
  // wipe a rating its source never carried — see the callers in data/imports/.
  rating?: number | null
  // Same three-state rule as `rating`, and not independent of it: the two are
  // one question with three answers. parseRatingSubmission keeps them consistent.
  disliked?: boolean | null
  // Three-state as well, for the same reason: a source with no notion of notes
  // must be able to say nothing rather than say "empty". Goodreads carries real
  // review text, Letterboxd's ratings export and Steam carry none.
  notes?: string | null
  consumedAt?: number
}

// 0 is not the bottom of the scale: "never rated" and "rated the lowest it goes"
// are different claims, so anything at or below 0 resolves to null.
export function parseRatingInput(raw: string): number | null {
  return normalizeRating(raw.trim() === '' ? null : Number(raw))
}

export function normalizeRating(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const rounded = Math.min(5, Math.round(raw * 2) / 2)
  return rounded < 0.5 ? null : rounded
}

// Not a number, so it can't be confused for one between form and column.
export const DISLIKED_INPUT_VALUE = 'disliked'

// One field in, both columns out. Parsing in one place is what keeps them
// mutually exclusive — split across two fields, a row can claim four stars and a
// dislike at once.
export function parseRatingSubmission(raw: string): { rating: number | null; disliked: boolean | null } {
  if (raw.trim() === DISLIKED_INPUT_VALUE) return { rating: null, disliked: true }
  return { rating: parseRatingInput(raw), disliked: null }
}

// Atomic on (user_id, media_item_id): findOne-then-write races when an import
// runs these in parallel and two rows resolve to the same item.
export async function logInteraction(
  db: Db,
  userId: number,
  mediaItemId: number,
  input: LogInteractionInput,
) {
  const now = Date.now()
  const consumedAt = input.consumedAt ?? now
  // updated_at drives the watched-list sort, so a caller backdating via
  // consumedAt has to win here too or every imported row reads as "logged today".
  const activityAt = input.consumedAt ?? now

  const values: Partial<UserMediaInteraction> = {
    user_id: userId,
    media_item_id: mediaItemId,
    status: input.status,
    rating: input.rating ?? undefined,
    disliked: input.disliked ?? undefined,
    notes: input.notes ?? undefined,
    created_at: now,
    updated_at: activityAt,
  }
  // Omitted when not marking consumed, so a later edit leaves consumed_at alone.
  const update: Partial<UserMediaInteraction> = {
    status: input.status,
    updated_at: activityAt,
  }
  // Written only when the caller has an opinion. Two rules, and they compose:
  //
  // `??` won't do, because it folds "no rating" back into "don't touch it",
  // leaving a rating impossible to clear. So undefined means leave it, null
  // means clear it — and the key has to be added conditionally to say that,
  // because the upsert writes a key that is present-but-undefined as NULL.
  // Setting `notes: input.notes ?? undefined` in the literal above therefore
  // cleared the note on every write that carried none: an import that has no
  // notes to give would erase the ones already written by hand.
  if (input.rating !== undefined) {
    update.rating = input.rating
  }
  if (input.disliked !== undefined) {
    update.disliked = input.disliked
  }
  if (input.notes !== undefined) {
    update.notes = input.notes
  }
  if (input.status === 'consumed') {
    values.consumed_at = consumedAt
    update.consumed_at = consumedAt
  }

  return db.query(userMediaInteractions).upsert(values, {
    conflictTarget: ['user_id', 'media_item_id'],
    update,
    returning: '*',
  })
}

export async function updateInteraction(
  db: Db,
  interactionId: number,
  userId: number,
  input: LogInteractionInput,
) {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return null

  const now = Date.now()
  return db.update(userMediaInteractions, interactionId, {
    status: input.status,
    // Same three-state rule as logInteraction: undefined leaves it, null clears
    // it. Spread rather than assigned, because a key that is present but
    // undefined is written as NULL rather than skipped.
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.disliked !== undefined ? { disliked: input.disliked } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    consumed_at: input.status === 'consumed' ? (existing.consumed_at ?? now) : (existing.consumed_at ?? undefined),
    updated_at: now,
  })
}

export async function deleteInteraction(db: Db, interactionId: number, userId: number): Promise<boolean> {
  const existing = await db.find(userMediaInteractions, interactionId)
  if (!existing || existing.user_id !== userId) return false

  return db.delete(userMediaInteractions, interactionId)
}

export async function getMediaItemDetail(db: Db, mediaItemId: number): Promise<MediaItem | null> {
  return (await db.find(mediaItems, mediaItemId)) ?? null
}

export async function getUserInteractionsForItems(db: Db, userId: number, mediaItemIds: number[]) {
  if (mediaItemIds.length === 0) return new Map<number, UserMediaInteraction>()

  const rows = await db.findMany(userMediaInteractions, {
    where: and(eq('user_id', userId), inList('media_item_id', mediaItemIds)),
  })
  return new Map(rows.map((row) => [row.media_item_id, row]))
}

export async function getUserInteractionForItem(db: Db, userId: number, mediaItemId: number) {
  return db.findOne(userMediaInteractions, { where: { user_id: userId, media_item_id: mediaItemId } })
}

// The whole log in two queries. For callers that partition one read across
// several media types (mediaSummary); anything wanting a single type or a page
// of one wants listUserMediaLog, which filters in the database.
export async function loadUserLogEntries(db: Db, userId: number): Promise<UserLogEntry[]> {
  const interactions = await db.findMany(userMediaInteractions, {
    where: { user_id: userId },
    orderBy: ['updated_at', 'desc'],
  })
  if (interactions.length === 0) return []

  const itemIds = [...new Set(interactions.map((interaction) => interaction.media_item_id))]
  const items = await db.findMany(mediaItems, { where: inList('id', itemIds) })
  const itemsById = new Map(items.map((item) => [item.id, item]))

  return interactions.map((interaction) => ({
    interaction,
    item: itemsById.get(interaction.media_item_id) ?? null,
  }))
}

export interface UserLogFilter {
  type?: MediaType
  // All of them when unset.
  statuses?: readonly InteractionStatus[]
}

export function matchesLogFilter(entry: UserLogEntry, filter: UserLogFilter): boolean {
  if (filter.type && entry.item?.type !== filter.type) return false
  if (filter.statuses && !filter.statuses.includes(entry.interaction.status)) return false
  return true
}

// The select every log read starts from, named once so a second query over the
// same two tables can't select a subset toLogEntry then reads as null.
const LOG_SELECT = `select i.id, i.user_id, i.media_item_id, i.status, i.rating, i.disliked, i.notes,
            i.consumed_at, i.created_at, i.updated_at,
            m.id as m_id, m.type as m_type, m.external_source as m_external_source,
            m.external_id as m_external_id, m.title as m_title, m.metadata as m_metadata,
            m.popularity_score as m_popularity_score, m.created_at as m_created_at`

// i.id breaks ties. updated_at alone is not unique — an import stamps a whole
// batch with one timestamp — and without a tiebreaker Postgres may order those
// rows differently per query, so paging through them can repeat one row and
// skip another.
const LOG_ORDER = `\n      order by i.updated_at desc, i.id desc`

// Raw SQL because `type` lives on the joined media_items row, which the table
// API can't reach — and pushing it down is what lets `limit`/`offset` mean
// anything. Filtering in JS made every page of a log load the whole log.
//
// LEFT JOIN, not INNER: an interaction whose item no longer resolves still
// belongs in an unfiltered log. A type filter drops it, since `m.type = $x`
// is NULL for a missing row — the same answer matchesLogFilter gives.
const LOG_WHERE = `
       from user_media_interactions i
       left join media_items m on m.id = i.media_item_id
      where i.user_id = $1
        and ($2::text is null or m.type = $2::text)
        and ($3::text[] is null or i.status = any($3::text[]))`

function logFilterParams(userId: number, filter: UserLogFilter): [number, string | null, string[] | null] {
  return [userId, filter.type ?? null, filter.statuses ? [...filter.statuses] : null]
}

interface LogRow {
  id: number
  user_id: number
  media_item_id: number
  status: InteractionStatus
  rating: number | null
  disliked: boolean | null
  notes: string | null
  consumed_at: number | null
  created_at: number
  updated_at: number
  m_id: number | null
  m_type: MediaType | null
  m_external_source: string | null
  m_external_id: string | null
  m_title: string | null
  m_metadata: unknown
  m_popularity_score: number | null
  m_created_at: number | null
}

function toLogEntry(row: LogRow): UserLogEntry {
  return {
    interaction: {
      id: row.id,
      user_id: row.user_id,
      media_item_id: row.media_item_id,
      status: row.status,
      rating: row.rating,
      disliked: row.disliked,
      notes: row.notes,
      consumed_at: row.consumed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    } as UserMediaInteraction,
    item:
      row.m_id == null
        ? null
        : ({
            id: row.m_id,
            type: row.m_type,
            external_source: row.m_external_source,
            external_id: row.m_external_id,
            title: row.m_title,
            metadata: row.m_metadata,
            popularity_score: row.m_popularity_score,
            created_at: row.m_created_at,
          } as MediaItem),
  }
}

export async function listUserMediaLog(
  db: Db,
  userId: number,
  options: UserLogFilter & { limit?: number; offset?: number } = {},
) {
  const params: unknown[] = logFilterParams(userId, options)
  let sql = LOG_SELECT + LOG_WHERE + LOG_ORDER

  if (options.limit != null) sql += `\n     limit $${params.push(options.limit)}`
  if (options.offset) sql += `\n    offset $${params.push(options.offset)}`

  const { rows } = await pool.query<LogRow>(sql, params)
  return rows.map(toLogEntry)
}

export async function countUserMediaLog(db: Db, userId: number, filter: UserLogFilter = {}): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count` + LOG_WHERE,
    logFilterParams(userId, filter),
  )
  return Number(rows[0]?.count ?? 0)
}

// One row of the following feed: a log entry plus who wrote it. The label is
// resolved here rather than in the page, because the fallback to email lives in
// displayLabel and the page has no user row to run it on.
export interface FollowingLogEntry extends UserLogEntry {
  actor: { id: number; label: string }
}

interface FollowingLogRow extends LogRow {
  u_display_name: string
  u_email: string
}

// The feed on the home page: what the people this viewer follows have logged,
// newest first.
//
// No privacy check beyond the join. `is_private` gates a profile behind a
// follow (see canViewProfile), and every row here is by definition someone the
// viewer already follows — so the join *is* the check. Rejections are excluded,
// the same way they are everywhere else a log is shown.
//
// One query rather than a log read per followed account: the interesting rows
// are the newest few across everyone, so fetching each person's log and merging
// in JS reads whole logs to throw nearly all of them away.
//
// The lateral is what keeps that true in SQL as well. A plain join reaches the
// same rows, but the only plan for it is to walk every interaction of everyone
// you follow and sort the lot to take `limit` — work that grows with your
// friends' whole libraries, which this app imports wholesale. Per followed
// account the lateral takes `limit` rows straight off
// user_media_interactions_user_recent, already ordered, and the outer sort sees
// followed_count × limit rows at most. $3 is deliberately both bounds: taking
// more than `limit` from any one person can't change the newest `limit` overall.
//
// `before` pages the feed: the row after which to continue, as the same
// (updated_at, id) pair the ordering uses. A plain `updated_at <` would drop
// rows — an import stamps a whole batch with one timestamp, so the boundary
// timestamp is routinely shared — which is why the tiebreaker is part of the
// cursor and the comparison is a row comparison rather than two predicates.
// It goes inside the lateral as well as outside: the inner slice is per
// account, so without it each person's `limit` rows are their newest ones over
// again and paging never advances past them.
export interface LogCursor {
  at: number
  id: number
}

export async function listFollowingLogActivity(
  viewerId: number,
  limit: number,
  before?: LogCursor,
): Promise<FollowingLogEntry[]> {
  // Row comparison against a NULL row is NULL, not true, so the no-cursor case
  // is spelled as its own `is null` branch rather than left to the comparison.
  const notAfterCursor = `
            and ($4::bigint is null or (i.updated_at, i.id) < ($4::bigint, $5::bigint))`

  const { rows } = await pool.query<FollowingLogRow>(
    LOG_SELECT +
      `, u.display_name as u_display_name, u.email as u_email
       from user_follows f
       join lateral (
         select *
           from user_media_interactions i
          where i.user_id = f.followed_id
            and i.status = any($2::text[])` +
      notAfterCursor +
      LOG_ORDER +
      `
          limit $3
       ) i on true
       join users u on u.id = i.user_id
       left join media_items m on m.id = i.media_item_id
      where f.follower_id = $1` +
      notAfterCursor +
      LOG_ORDER +
      `\n      limit $3`,
    [viewerId, [...CONSUMPTION_STATUSES], limit, before?.at ?? null, before?.id ?? null],
  )

  return rows.map((row) => ({
    ...toLogEntry(row),
    actor: {
      id: row.user_id,
      label: displayLabel({ display_name: row.u_display_name, email: row.u_email }),
    },
  }))
}

// Rejections don't count, the same rule findMembersMissingSourceLogs uses.
//
// One query rather than a count per person per type: loadUserLogEntries pulls a
// whole log per call, so the obvious loop is one full load per follower per type.
export async function loadLoggedTypesByUser(userIds: number[]): Promise<Map<number, Set<MediaType>>> {
  const byUser = new Map<number, Set<MediaType>>(userIds.map((id) => [id, new Set<MediaType>()]))
  if (userIds.length === 0) return byUser

  const { rows } = await pool.query<{ user_id: number; type: MediaType }>(
    `select i.user_id, m.type
       from user_media_interactions i
       join media_items m on m.id = i.media_item_id
      where i.user_id = any($1)
        and i.status = any($2)
      group by i.user_id, m.type`,
    [userIds, [...CONSUMPTION_STATUSES]],
  )

  for (const row of rows) byUser.get(row.user_id)?.add(row.type)
  return byUser
}
