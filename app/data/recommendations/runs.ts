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

export const MAX_RUNS_PER_USER = 3

export interface RecommendationResult {
  item: MediaItem
  reason: string
  // Looked up live, not frozen at generation time. The whole row rather than
  // just its status, so the run page's log control can pre-fill rating and
  // notes — submitting without them would write null over what's there.
  interaction: UserMediaInteraction | null
}

export interface RecommendationRunSummary {
  id: number
  createdAt: number
  groupLabel: string
  mediaType: MediaType
  name: string | null
}

// sourceTypes always has at least one entry — runs generated before it was
// tracked fall back to [mediaType] in parseParams.
export interface GenerationParams {
  genre?: string
  decade?: number
  // Defaults to 'within' when `decade` is set — see matchesDecade.
  decadeRelation?: DecadeRelation
  length?: LengthBucket
  // Games only — see GAME_PLAYER_TYPES / GAME_MULTIPLAYER_TYPES.
  playerType?: string
  multiplayerType?: string
  // Books only — see BOOK_SERIES_TYPES.
  series?: string
  sourceTypes: MediaType[]
}

export interface RecommendationRunDetail extends RecommendationRunSummary {
  otherMemberLabels: string[]
  results: RecommendationResult[]
  params: GenerationParams
}

// An earlier run with these levers that the user hasn't acted on.
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
      series: parsed.series,
      sourceTypes: parsed.sourceTypes && parsed.sourceTypes.length > 0 ? parsed.sourceTypes : [run.media_type],
    }
  } catch {
    return { sourceTypes: [run.media_type] }
  }
}

// Canonical, so two requests that mean the same thing compare equal.
// JSON.stringify of the params object won't do: key order, dropped
// `undefined`s and checkbox order all vary independently of meaning.
function paramsKey(filters: RecommendationFilters, sourceTypes: MediaType[], memberIds: number[]): string {
  return JSON.stringify([
    filters.genre ?? null,
    filters.decade ?? null,
    filters.decade != null ? (filters.decadeRelation ?? 'within') : null,
    filters.length ?? null,
    filters.playerType ?? null,
    filters.multiplayerType ?? null,
    filters.series ?? null,
    [...sourceTypes].sort(),
    // A group run with different people is a different request, even with
    // identical filters.
    [...memberIds].sort((a, b) => a - b),
  ])
}

// "Acted on" means logging one of its own picks — deliberately not "has
// anything been logged since", which unrelated activity would satisfy. A run
// with everything still unlogged means a second list would go unfinished too.
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
        series: params.series,
      },
      params.sourceTypes,
      members.map((member) => member.user_id),
    )
    if (key !== wanted) continue

    // Only the latest run with these levers counts: once you've worked through
    // it, asking again is a real request, and being sent back to an older
    // untouched one would be worse than useless.
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

// Relative to `viewerId`, who isn't necessarily the requester — any member can
// view a run.
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
  // Optional user-given label for the run, e.g. "Cozy weekend picks".
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

  for (const memberId of input.memberUserIds) {
    await db.create(recommendationRunMembers, { run_id: run.id, user_id: memberId })
  }

  for (const [index, result] of input.results.entries()) {
    await db.create(userRecommendations, {
      run_id: run.id,
      media_item_id: result.item.id,
      reason: result.reason,
      rank: index + 1,
    })
  }

  return run.id
}

// Scoped to one media type, so a TV run never prunes an older movie run.
// Members and picks go with it via ON DELETE CASCADE.
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

// Group runs someone else requested this user into. Restricted to mutual
// follows — being added to someone's run isn't consent to show up on their
// page. See getRecommendationRun for why this is stricter than the access check.
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

// Null (a 404) if the run doesn't exist or this user wasn't in it. Access is
// membership and membership is permanent — deliberately unlike
// listRecommendationRunsFromOthers, which gates on *current* mutual follow.
//
// The two answer different questions: "may I see this run" stays yes because it
// was built partly from your taste, while the listing is about who you're
// connected to now. So after unfollowing, a shared run leaves your list but its
// URL still works. That mismatch is intended.
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
