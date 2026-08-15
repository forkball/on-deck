import { and, eq, inList } from 'remix/data-table'

import type { LengthBucket } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { isFollowing } from '../follows.ts'
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

  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId, media_type: mediaType },
    orderBy: ['created_at', 'desc'],
  })

  for (const run of runs) {
    const params = parseParams(run)
    const members = await db.findMany(recommendationRunMembers, { where: { run_id: run.id } })
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
      members.map((member) => member.user_id),
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

async function listOtherMemberLabels(db: Db, viewerId: number, run: RecommendationRun): Promise<string[]> {
  const memberRows = await db.findMany(recommendationRunMembers, { where: { run_id: run.id } })
  const otherMemberIds = memberRows.map((m) => m.user_id).filter((id) => id !== viewerId)
  if (otherMemberIds.length === 0) return []

  const otherUsers = await db.findMany(users, { where: inList('id', otherMemberIds) })
  return otherUsers.map(displayLabel)
}

async function buildGroupLabel(db: Db, viewerId: number, run: RecommendationRun): Promise<string> {
  const otherMemberLabels = await listOtherMemberLabels(db, viewerId, run)
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

// Scoped to one media type, so a TV run never prunes an older movie run.
export async function pruneOldRuns(db: Db, userId: number, mediaType: MediaType): Promise<boolean> {
  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId, media_type: mediaType },
    orderBy: ['created_at', 'asc'],
  })
  if (runs.length <= MAX_RUNS_PER_USER) return false

  const excess = runs.slice(0, runs.length - MAX_RUNS_PER_USER)
  await db.deleteMany(recommendationRuns, { where: inList('id', excess.map((run) => run.id)) })
  return true
}

export async function listRecommendationRuns(db: Db, userId: number): Promise<RecommendationRunSummary[]> {
  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
  })

  return Promise.all(
    runs.map(async (run) => ({
      id: run.id,
      createdAt: run.created_at,
      groupLabel: await buildGroupLabel(db, userId, run),
      mediaType: run.media_type,
      name: run.name,
    })),
  )
}

// Restricted to mutual follows — being added to someone's run isn't consent to
// show up on their page. Deliberately stricter than getRecommendationRun.
export async function listRecommendationRunsFromOthers(db: Db, userId: number): Promise<RecommendationRunSummary[]> {
  const memberships = await db.findMany(recommendationRunMembers, { where: { user_id: userId } })
  if (memberships.length === 0) return []

  const runs = await db.findMany(recommendationRuns, { where: inList('id', memberships.map((m) => m.run_id)) })
  const runsFromOthers = runs.filter((run) => run.user_id !== userId)
  if (runsFromOthers.length === 0) return []

  const requesterIds = [...new Set(runsFromOthers.map((run) => run.user_id))]
  const mutualByRequesterId = new Map(
    await Promise.all(
      requesterIds.map(async (requesterId): Promise<[number, boolean]> => {
        const [requesterFollowsUser, userFollowsRequester] = await Promise.all([
          isFollowing(db, requesterId, userId),
          isFollowing(db, userId, requesterId),
        ])
        return [requesterId, requesterFollowsUser && userFollowsRequester]
      }),
    ),
  )

  const eligibleRuns = runsFromOthers
    .filter((run) => mutualByRequesterId.get(run.user_id))
    .sort((a, b) => b.created_at - a.created_at)

  return Promise.all(
    eligibleRuns.map(async (run) => ({
      id: run.id,
      createdAt: run.created_at,
      groupLabel: await buildGroupLabel(db, userId, run),
      mediaType: run.media_type,
      name: run.name,
    })),
  )
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

  const groupLabel = await buildGroupLabel(db, userId, run)
  const otherMemberLabels = await listOtherMemberLabels(db, userId, run)
  const params = parseParams(run)
  const rows = await db.findMany(userRecommendations, { where: { run_id: runId }, orderBy: ['rank', 'asc'] })
  if (rows.length === 0) {
    return {
      id: run.id,
      createdAt: run.created_at,
      groupLabel,
      mediaType: run.media_type,
      name: run.name,
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
    otherMemberLabels,
    results,
    params,
  }
}
