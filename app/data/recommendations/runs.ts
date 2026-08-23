import { and, eq, inList, lt, or } from 'remix/data-table'

import type { LengthBucket } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { listFollowerIds, listFollowingIds } from '../follows.ts'
import type { MediaType } from '../mediaItems.ts'
import {
  mediaItems,
  recommendationRunMembers,
  recommendationRuns,
  users,
  userMediaInteractions,
  userRecommendations,
  type MediaItem,
  type RecommendationRun,
  type UserMediaInteraction,
} from '../schema.ts'
import { displayLabel } from '../users.ts'
import type { DecadeRelation, RecommendationFilters } from './picks.ts'
import type { RunTimings } from './timings.ts'

export const MAX_RUNS_PER_USER = 3

// Lucky runs are capped the same way, but counted separately — see pruneOldRuns.
// Three days of them is enough to keep a link someone was sent still resolving,
// which is all the history a once-a-day pick needs.
export const MAX_LUCKY_RUNS_PER_USER = 3

export interface RecommendationResult {
  item: MediaItem
  reason: string
  // The whole row, not just its status: the run page's log control pre-fills
  // rating and notes, and submitting without them writes null over what's there.
  interaction: UserMediaInteraction | null
}

export interface RecommendationRunSummary {
  id: number
  createdAt: number
  groupLabel: string
  mediaType: MediaType
  name: string | null
  // An "I'm feeling lucky" run — one pick, no filters, once a day. Kept and
  // pruned on its own track, so an ordinary run can never evict today's pick.
  isLucky: boolean
  // Who generated it, or null when that is the viewer. Null rather than the
  // viewer's own label because the two say different things on screen — "you
  // generated" is a sentence the reader is in, and the home feed interleaves
  // these rows with other people's, where the distinction is the whole point.
  owner: { id: number; label: string } | null
}

// Where to continue a listing from: the run after which to resume, as the same
// (createdAt, id) pair the ordering uses. The id is part of it because two runs
// can share a millisecond, and a plain `createdAt <` would drop one of them.
export interface RunCursor {
  at: number
  id: number
}

// The `where` fragment for a cursor, as the table API spells a row comparison:
// older, or the same instant and a lower id.
function olderThan(cursor: RunCursor) {
  return or(lt('created_at', cursor.at), and(eq('created_at', cursor.at), lt('id', cursor.id)))
}

// sourceTypes always has at least one entry — see parseParams.
export interface GenerationParams {
  genre?: string
  decade?: number
  decadeRelation?: DecadeRelation
  length?: LengthBucket
  playerType?: string
  multiplayerType?: string
  platform?: string
  series?: string
  sourceTypes: MediaType[]
}

export interface RecommendationRunDetail extends RecommendationRunSummary {
  otherMemberLabels: string[]
  results: RecommendationResult[]
  params: GenerationParams
}

export interface UnusedDuplicateRun {
  runId: number
  name: string | null
  createdAt: number
}

function parseParams(run: RecommendationRun): GenerationParams {
  try {
    const parsed = JSON.parse(run.params) as Partial<GenerationParams>
    return {
      genre: parsed.genre,
      decade: parsed.decade,
      decadeRelation: parsed.decadeRelation,
      length: parsed.length,
      playerType: parsed.playerType,
      multiplayerType: parsed.multiplayerType,
      platform: parsed.platform,
      series: parsed.series,
      sourceTypes: parsed.sourceTypes && parsed.sourceTypes.length > 0 ? parsed.sourceTypes : [run.media_type],
    }
  } catch {
    return { sourceTypes: [run.media_type] }
  }
}

// JSON.stringify of the params object won't do: key order, dropped `undefined`s
// and checkbox order all vary independently of meaning.
function paramsKey(filters: RecommendationFilters, sourceTypes: MediaType[], memberIds: number[]): string {
  return JSON.stringify([
    filters.genre ?? null,
    filters.decade ?? null,
    filters.decade != null ? (filters.decadeRelation ?? 'within') : null,
    filters.length ?? null,
    filters.playerType ?? null,
    filters.multiplayerType ?? null,
    filters.platform ?? null,
    filters.series ?? null,
    [...sourceTypes].sort(),
    [...memberIds].sort((a, b) => a - b),
  ])
}

// "Acted on" means logging one of this run's own picks — not "has anything been
// logged since", which unrelated activity would satisfy.
export async function findUnusedDuplicateRun(
  db: Db,
  userId: number,
  memberIds: number[],
  mediaType: MediaType,
  filters: RecommendationFilters,
  sourceTypes: MediaType[],
): Promise<UnusedDuplicateRun | null> {
  const wanted = paramsKey(filters, sourceTypes.length > 0 ? sourceTypes : [mediaType], memberIds)

  // Lucky runs are excluded: they carry no filters, so every one of them keys
  // the same as an unfiltered solo run and would have the notice offering
  // yesterday's single pick as "a recommendation like this".
  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId, media_type: mediaType, is_lucky: false },
    orderBy: ['created_at', 'desc'],
  })

  // Every run's members in one query: the loop below compares a key per run, so
  // asking per run paid a round trip even for the ones that don't match.
  const memberRows =
    runs.length === 0
      ? []
      : await db.findMany(recommendationRunMembers, { where: inList('run_id', runs.map((run) => run.id)) })
  const memberIdsByRun = new Map<number, number[]>(runs.map((run) => [run.id, []]))
  for (const row of memberRows) memberIdsByRun.get(row.run_id)?.push(row.user_id)

  for (const run of runs) {
    const params = parseParams(run)
    const key = paramsKey(
      {
        genre: params.genre,
        decade: params.decade,
        decadeRelation: params.decadeRelation,
        length: params.length,
        playerType: params.playerType,
        multiplayerType: params.multiplayerType,
        platform: params.platform,
        series: params.series,
      },
      params.sourceTypes,
      memberIdsByRun.get(run.id) ?? [],
    )
    if (key !== wanted) continue

    // Only the latest run with these levers counts.
    const picks = await db.findMany(userRecommendations, { where: { run_id: run.id } })
    if (picks.length === 0) return null

    const logged = await db.findMany(userMediaInteractions, {
      where: and(
        eq('user_id', userId),
        inList(
          'media_item_id',
          picks.map((pick) => pick.media_item_id),
        ),
      ),
    })
    if (logged.length > 0) return null

    return { runId: run.id, name: run.name ?? null, createdAt: Number(run.created_at) }
  }

  return null
}

// Two queries for a whole list of runs, not two per run. The member rows and
// the user rows they name are each fetched once and grouped here; asking per
// run made a page of runs cost a round trip apiece for the same handful of
// people.
async function loadOtherMemberLabels(
  db: Db,
  viewerId: number,
  runs: RecommendationRun[],
): Promise<Map<number, string[]>> {
  const byRun = new Map<number, string[]>(runs.map((run) => [run.id, []]))
  if (runs.length === 0) return byRun

  const memberRows = await db.findMany(recommendationRunMembers, {
    where: inList('run_id', runs.map((run) => run.id)),
  })
  const otherMemberIds = [...new Set(memberRows.map((row) => row.user_id))].filter((id) => id !== viewerId)
  if (otherMemberIds.length === 0) return byRun

  const otherUsers = await db.findMany(users, { where: inList('id', otherMemberIds) })
  const labelByUserId = new Map(otherUsers.map((user) => [user.id, displayLabel(user)]))

  for (const row of memberRows) {
    const label = labelByUserId.get(row.user_id)
    if (label) byRun.get(row.run_id)?.push(label)
  }
  return byRun
}

async function listOtherMemberLabels(db: Db, viewerId: number, run: RecommendationRun): Promise<string[]> {
  return (await loadOtherMemberLabels(db, viewerId, [run])).get(run.id) ?? []
}

function groupLabelFrom(otherMemberLabels: string[]): string {
  if (otherMemberLabels.length === 0) return 'Just you'
  return `You + ${otherMemberLabels.join(', ')}`
}

export interface SaveRunInput {
  requestingUserId: number
  memberUserIds: number[]
  mediaType: MediaType
  name?: string
  params: GenerationParams
  results: RecommendationResult[]
  lucky?: boolean
}

export async function saveRun(db: Db, input: SaveRunInput): Promise<number> {
  const run = await db.create(
    recommendationRuns,
    {
      user_id: input.requestingUserId,
      media_type: input.mediaType,
      created_at: Date.now(),
      name: input.name?.trim() || undefined,
      params: JSON.stringify(input.params),
      is_lucky: input.lucky === true,
    },
    { returnRow: true },
  )

  await Promise.all([
    ...input.memberUserIds.map((memberId) =>
      db.create(recommendationRunMembers, { run_id: run.id, user_id: memberId }),
    ),
    ...input.results.map((result, index) =>
      db.create(userRecommendations, {
        run_id: run.id,
        media_item_id: result.item.id,
        reason: result.reason,
        rank: index + 1,
      }),
    ),
  ])

  return run.id
}

export async function saveRunTimings(db: Db, runId: number, timings: RunTimings): Promise<void> {
  await db.updateMany(recommendationRuns, { timings: JSON.stringify(timings) }, { where: { id: runId } })
}

// Scoped to one media type, so a TV run never prunes an older movie run — and
// to one track, so an ordinary run never prunes a lucky one. The second scope is
// what lets the landing page rely on today's lucky pick still being there:
// without it, three ordinary movie runs would evict it before the day was out.
export async function pruneOldRuns(
  db: Db,
  userId: number,
  mediaType: MediaType,
  options: { lucky?: boolean } = {},
): Promise<boolean> {
  const lucky = options.lucky === true
  const keep = lucky ? MAX_LUCKY_RUNS_PER_USER : MAX_RUNS_PER_USER

  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId, media_type: mediaType, is_lucky: lucky },
    orderBy: ['created_at', 'asc'],
  })
  if (runs.length <= keep) return false

  const excess = runs.slice(0, runs.length - keep)
  await db.deleteMany(recommendationRuns, { where: inList('id', excess.map((run) => run.id)) })
  return true
}

// `mediaType` filters in the query rather than leaving the caller to discard
// what it didn't want: the cap is per media type, so an unfiltered read returns
// every type's runs and builds a group label for each one before three quarters
// of them are thrown away.
export async function listRecommendationRuns(
  db: Db,
  userId: number,
  mediaType?: MediaType,
  // Applied before the labels are built, for the same reason mediaType filters
  // in the query: a caller that wants three runs shouldn't make this fetch a
  // name for every member of thirty.
  limit?: number,
  // Where to resume — see RunCursor. Left out, the listing starts at the newest.
  before?: RunCursor,
): Promise<RecommendationRunSummary[]> {
  const mine = eq('user_id', userId)
  const ofType = mediaType ? eq('media_type', mediaType) : undefined
  const older = before ? olderThan(before) : undefined

  const runs = await db.findMany(recommendationRuns, {
    where:
      ofType && older
        ? and(mine, ofType, older)
        : ofType
          ? and(mine, ofType)
          : older
            ? and(mine, older)
            : mine,
    // id breaks ties, so the ordering matches what a RunCursor resumes from.
    orderBy: [
      ['created_at', 'desc'],
      ['id', 'desc'],
    ],
    limit,
  })

  const labels = await loadOtherMemberLabels(db, userId, runs)

  return runs.map((run) => ({
    id: run.id,
    createdAt: run.created_at,
    groupLabel: groupLabelFrom(labels.get(run.id) ?? []),
    mediaType: run.media_type,
    name: run.name,
    isLucky: run.is_lucky,
    // These are the viewer's own runs by construction — the query filters on
    // their user_id — so there is no one else to name.
    owner: null,
  }))
}

// Restricted to mutual follows — being added to someone's run isn't consent to
// show up on their page. Deliberately stricter than getRecommendationRun.
export async function listRecommendationRunsFromOthers(
  db: Db,
  userId: number,
  mediaType?: MediaType,
  // See listRecommendationRuns. Applied after the mutual-follow filter, since
  // that is what decides which runs are eligible at all.
  limit?: number,
  // Also applied in JS rather than in the query, for the same reason: which
  // runs are eligible isn't known until the follow check has run.
  before?: RunCursor,
): Promise<RecommendationRunSummary[]> {
  const memberships = await db.findMany(recommendationRunMembers, { where: { user_id: userId } })
  if (memberships.length === 0) return []

  const runs = await db.findMany(recommendationRuns, { where: inList('id', memberships.map((m) => m.run_id)) })
  const runsFromOthers = runs.filter(
    (run) => run.user_id !== userId && (mediaType === undefined || run.media_type === mediaType),
  )
  if (runsFromOthers.length === 0) return []

  // Both directions in two queries rather than two per requester.
  const requesterIds = [...new Set(runsFromOthers.map((run) => run.user_id))]
  const [userFollows, followsUser] = await Promise.all([
    listFollowingIds(db, userId, requesterIds),
    listFollowerIds(db, userId, requesterIds),
  ])

  const eligibleRuns = runsFromOthers
    .filter((run) => userFollows.has(run.user_id) && followsUser.has(run.user_id))
    .filter(
      (run) =>
        before === undefined ||
        run.created_at < before.at ||
        (run.created_at === before.at && run.id < before.id),
    )
    // Same ordering a RunCursor resumes from, id included.
    .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
    .slice(0, limit)

  if (eligibleRuns.length === 0) return []

  // Who generated each one. The member labels below cover everyone *else* in
  // the run, which on someone else's run is usually the requester too — but not
  // always, so the owners are read rather than picked out of that map.
  const ownerIds = [...new Set(eligibleRuns.map((run) => run.user_id))]
  const [labels, owners] = await Promise.all([
    loadOtherMemberLabels(db, userId, eligibleRuns),
    db.findMany(users, { where: inList('id', ownerIds) }),
  ])
  const ownerById = new Map(owners.map((owner) => [owner.id, displayLabel(owner)]))

  return eligibleRuns.map((run) => ({
    id: run.id,
    createdAt: run.created_at,
    groupLabel: groupLabelFrom(labels.get(run.id) ?? []),
    mediaType: run.media_type,
    name: run.name,
    isLucky: run.is_lucky,
    owner: { id: run.user_id, label: ownerById.get(run.user_id) ?? 'Someone' },
  }))
}

// Access is membership, and membership is permanent — unlike
// listRecommendationRunsFromOthers, which gates on *current* mutual follow. The
// mismatch is intended: after unfollowing, a shared run leaves your list but its
// URL still works.
export async function getRecommendationRun(
  db: Db,
  runId: number,
  userId: number,
): Promise<RecommendationRunDetail | null> {
  const run = await db.find(recommendationRuns, runId)
  if (!run) return null

  if (run.user_id !== userId) {
    const membership = await db.findOne(recommendationRunMembers, { where: { run_id: runId, user_id: userId } })
    if (!membership) return null
  }

  const otherMemberLabels = await listOtherMemberLabels(db, userId, run)
  const groupLabel = groupLabelFrom(otherMemberLabels)
  const params = parseParams(run)
  // Only looked up when the run is someone else's; on your own there is nobody
  // to name, which is what `null` means here.
  const ownerRow = run.user_id === userId ? null : await db.find(users, run.user_id)
  const owner = ownerRow ? { id: ownerRow.id, label: displayLabel(ownerRow) } : null
  const rows = await db.findMany(userRecommendations, { where: { run_id: runId }, orderBy: ['rank', 'asc'] })
  if (rows.length === 0) {
    return {
      id: run.id,
      createdAt: run.created_at,
      groupLabel,
      mediaType: run.media_type,
      name: run.name,
      isLucky: run.is_lucky,
      owner,
      otherMemberLabels,
      results: [],
      params,
    }
  }

  const mediaItemIds = rows.map((row) => row.media_item_id)
  const [items, interactionRows] = await Promise.all([
    db.findMany(mediaItems, { where: inList('id', mediaItemIds) }),
    db.findMany(userMediaInteractions, {
      where: and(eq('user_id', userId), inList('media_item_id', mediaItemIds)),
    }),
  ])
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const interactionByItemId = new Map<number, UserMediaInteraction>(
    interactionRows.map((row) => [row.media_item_id, row]),
  )

  const results: RecommendationResult[] = []
  for (const row of rows) {
    const item = itemsById.get(row.media_item_id)
    if (!item) continue
    results.push({
      item,
      reason: row.reason,
      interaction: interactionByItemId.get(item.id) ?? null,
    })
  }

  return {
    id: run.id,
    createdAt: run.created_at,
    groupLabel,
    mediaType: run.media_type,
    name: run.name,
    isLucky: run.is_lucky,
    owner,
    otherMemberLabels,
    results,
    params,
  }
}
