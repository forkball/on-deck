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
import type { RecommendationFilters } from './picks.ts'

// Exported so the UI can tell users about the cap without duplicating it.
export const MAX_RUNS_PER_USER = 3

export interface RecommendationResult {
  item: MediaItem
  reason: string
  // Your current log entry for this item, if any (e.g. it's already on your
  // watchlist, or you're mid-way through it) — looked up live, not frozen at
  // generation time. The whole row rather than just its status, so the log
  // control on the run page can pre-fill rating and notes: submitting without
  // them would write null over what's there.
  interaction: UserMediaInteraction | null
}

export interface RecommendationRunSummary {
  id: number
  createdAt: number
  groupLabel: string
  mediaType: MediaType
  name: string | null
}

// The levers used to generate a run, as shown back on its detail page.
// sourceTypes always has at least one entry — old runs (generated before
// this was tracked) fall back to [mediaType] in parseParams below.
export interface GenerationParams {
  genre?: string
  decade?: number
  length?: LengthBucket
  sourceTypes: MediaType[]
}

export interface RecommendationRunDetail extends RecommendationRunSummary {
  otherMemberLabels: string[]
  results: RecommendationResult[]
  params: GenerationParams
}

// An earlier run with these exact levers that the user hasn't taken anything
// from yet.
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
      length: parsed.length,
      sourceTypes: parsed.sourceTypes && parsed.sourceTypes.length > 0 ? parsed.sourceTypes : [run.media_type],
    }
  } catch {
    return { sourceTypes: [run.media_type] }
  }
}

// Canonical string for a set of levers, so two requests that mean the same
// thing compare equal. JSON.stringify of the params object won't do it: key
// order and dropped `undefined`s make the same filters serialise differently,
// and source types arrive in whatever order the checkboxes were ticked.
function paramsKey(filters: RecommendationFilters, sourceTypes: MediaType[], memberIds: number[]): string {
  return JSON.stringify([
    filters.genre ?? null,
    filters.decade ?? null,
    filters.length ?? null,
    [...sourceTypes].sort(),
    // A group run with different people is a different request, even with
    // identical filters.
    [...memberIds].sort((a, b) => a - b),
  ])
}

// Finds a previous run with the same levers that the user hasn't acted on.
//
// "Acted on" means logging one of its picks. That's the signal the run was
// actually used for something; a run whose picks are all still unlogged is
// one the person hasn't worked through yet, so generating another costs a
// model call to hand them a second list they didn't finish the first of.
//
// Deliberately not "has anything been logged since" — logging unrelated
// things doesn't mean this list was used.
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
      { genre: params.genre, decade: params.decade, length: params.length },
      params.sourceTypes,
      members.map((member) => member.user_id),
    )
    if (key !== wanted) continue

    // Only the *latest* run with these levers is considered, which is why
    // this returns from the first match rather than scanning past it. Once
    // you've worked through that list, asking again is a real request — being
    // sent back to an older, still-untouched run with the same settings would
    // be worse than useless.
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

// Every other member's display label, relative to `viewerId` — not
// necessarily the run's original requester, since any member can view a run.
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

// Writes a finished run and its picks, returning the new run's id.
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

// Deletes the oldest run(s) for a user beyond MAX_RUNS_PER_USER, scoped to
// one media type — a TV run should never prune an older movie run just
// because the combined total crossed the cap. Returns whether anything was
// deleted. Relies on recommendation_run_members and user_recommendations
// cascading on delete of the run row.
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

// Group runs someone else requested that included this user as a member —
// e.g. a friend generated picks "for" a group they added this user to.
// Restricted to mutual follows (same bar as notifyMutualFollowers): being
// added to someone's run isn't itself consent to show up on their page, so
// this only surfaces if the requester also follows this user back. See
// getRecommendationRun for why this is stricter than the access check.
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

// Returns null if the run doesn't exist or userId wasn't part of it (the
// requester or one of the invited members) — the dedicated
// /recommendations/:id page treats that as 404. Membership, not just
// ownership, matters now that other members get notified about group runs.
// Access is membership, and membership is permanent — deliberately unlike
// listRecommendationRunsFromOthers above, which gates on *current* mutual
// follow.
//
// The two answer different questions. This one is "may I see this run", and
// the answer stays yes because the run was built partly from your own taste;
// unfollowing someone shouldn't confiscate it. The listing is "what belongs in
// my feed", which is about who you're connected to now.
//
// The visible consequence, checked rather than assumed: after unfollowing, a
// shared run vanishes from your list but its URL still works and an existing
// notification still opens it. Re-following brings it back. That mismatch is
// intended, not an oversight.
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
