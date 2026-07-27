import { and, eq, inList } from 'remix/data-table'

import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from './db.ts'
import { isFollowing } from './follows.ts'
import { upsertMovie } from './movies.ts'
import { createNotification } from './notifications.ts'
import {
  mediaItems,
  mediaItemTags,
  recommendationRunMembers,
  recommendationRuns,
  users,
  userMediaInteractions,
  userRecommendations,
  type MediaItem,
  type RecommendationRun,
} from './schema.ts'
import { searchMovies } from './tmdb.ts'
import { regenerateTasteProfile } from './tasteProfile.ts'
import { displayLabel } from './users.ts'

interface MemberProfile {
  label: string
  summary: string
  liked_tags: string[]
  disliked_tags: string[]
}

const PICKS_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    picks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          title: { type: 'string' as const },
          year: { type: 'number' as const },
          reason: { type: 'string' as const },
        },
        required: ['title', 'year', 'reason'],
      },
    },
  },
  required: ['picks'],
}

interface Pick {
  title: string
  year: number
  reason: string
}

const TARGET_COUNT = 10
const REQUESTED_COUNT = 15

// Exported so the UI can tell users about the cap without duplicating it.
export const MAX_RUNS_PER_USER = 3

export interface RecommendationResult {
  item: MediaItem
  tags: string[]
  reason: string
  // Your current interaction with this item, if any (e.g. it's already on
  // your watchlist, or you're mid-way through it) — looked up live, not
  // frozen at generation time.
  status: string | null
}

export interface RecommendationRunSummary {
  id: number
  createdAt: number
  groupLabel: string
}

export interface RecommendationRunDetail extends RecommendationRunSummary {
  otherMemberLabels: string[]
  results: RecommendationResult[]
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

export interface GenerateRecommendationsOutcome {
  runId: number
  // Whether generating this run pushed the user over MAX_RUNS_PER_USER and
  // caused their oldest run to be deleted.
  prunedOldestRun: boolean
}

// Generates one indexed, dated run of picks and returns its id — history is
// kept (never replaced), so every run stays browsable at /recommendations/:id.
// Runs are capped at MAX_RUNS_PER_USER per user; generating past the cap
// deletes the oldest run (cascading to its members/results).
export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
): Promise<GenerateRecommendationsOutcome> {
  // Independent per member — regenerate every profile (and fetch their name) concurrently.
  const members = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [profile, user] = await Promise.all([regenerateTasteProfile(db, memberId), db.find(users, memberId)])
      return { profile, label: user ? displayLabel(user) : `User ${memberId}` }
    }),
  )

  const profiles: MemberProfile[] = members.map(({ profile, label }) => ({ label, ...profile }))

  const excludedTitles: string[] = []
  const excludedExternalIds = new Set<string>()
  for (const { profile } of members) {
    for (const { interaction, item } of profile.log) {
      if (interaction.status !== 'consumed') continue
      if (item?.title) excludedTitles.push(item.title)
      if (item?.external_id) excludedExternalIds.add(item.external_id)
    }
  }

  const picks = await requestPicks(profiles, excludedTitles)

  // Independent lookups — resolve every pick against TMDB concurrently, then
  // apply the same dedup/target-count selection over the results in order.
  const matchesByPick = await Promise.all(picks.map((pick) => searchMovies(pick.title)))

  const results: RecommendationResult[] = []
  const seenExternalIds = new Set<string>()

  for (const [i, pick] of picks.entries()) {
    if (results.length >= TARGET_COUNT) break

    const matches = matchesByPick[i]
    if (matches.length === 0) continue

    const match =
      matches.find((m) => m.releaseYear === pick.year) ??
      [...matches].sort(
        (a, b) => Math.abs((a.releaseYear ?? 0) - pick.year) - Math.abs((b.releaseYear ?? 0) - pick.year),
      )[0]

    if (excludedExternalIds.has(match.externalId) || seenExternalIds.has(match.externalId)) continue
    seenExternalIds.add(match.externalId)

    const item = await upsertMovie(db, match)
    results.push({ item, tags: match.tags, reason: pick.reason, status: null })
  }

  const run = await db.create(
    recommendationRuns,
    { user_id: requestingUserId, created_at: Date.now() },
    { returnRow: true },
  )

  for (const memberId of memberUserIds) {
    await db.create(recommendationRunMembers, { run_id: run.id, user_id: memberId })
  }

  for (const [index, result] of results.entries()) {
    await db.create(userRecommendations, {
      run_id: run.id,
      media_item_id: result.item.id,
      reason: result.reason,
      rank: index + 1,
    })
  }

  await notifyMutualFollowers(db, requestingUserId, memberUserIds, run.id)

  const prunedOldestRun = await pruneOldRuns(db, requestingUserId)

  return { runId: run.id, prunedOldestRun }
}

// Notifies the other members of a group run, but only ones who mutually
// follow the requester (the friend picker already requires the requester to
// follow them; this also requires the follow back before pinging them).
async function notifyMutualFollowers(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
  runId: number,
): Promise<void> {
  const otherMemberIds = memberUserIds.filter((id) => id !== requestingUserId)

  await Promise.all(
    otherMemberIds.map(async (memberId) => {
      const [requesterFollowsMember, memberFollowsRequester] = await Promise.all([
        isFollowing(db, requestingUserId, memberId),
        isFollowing(db, memberId, requestingUserId),
      ])
      if (!requesterFollowsMember || !memberFollowsRequester) return

      await createNotification(db, { userId: memberId, actorUserId: requestingUserId, runId })
    }),
  )
}

// Deletes the oldest run(s) for a user beyond MAX_RUNS_PER_USER. Returns
// whether anything was deleted. Relies on recommendation_run_members and
// user_recommendations cascading on delete of the run row.
async function pruneOldRuns(db: Db, userId: number): Promise<boolean> {
  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId },
    orderBy: ['created_at', 'asc'],
  })
  if (runs.length <= MAX_RUNS_PER_USER) return false

  const excess = runs.slice(0, runs.length - MAX_RUNS_PER_USER)
  await db.deleteMany(recommendationRuns, { where: inList('id', excess.map((run) => run.id)) })
  return true
}

async function requestPicks(profiles: MemberProfile[], excludedTitles: string[]): Promise<Pick[]> {
  const isGroup = profiles.length > 1

  const prompt = isGroup
    ? `Group of ${profiles.length} people, each with their own taste profile:\n${JSON.stringify(profiles, null, 2)}\n\n` +
      `Suggest ${REQUESTED_COUNT} real movies (not from any fixed list — use your own knowledge) this group ` +
      `should watch together. Reason explicitly about tradeoffs: avoid picks only one person would like; ` +
      `prefer broad appeal; where genuinely interesting, surface a pick that bridges members' different tastes ` +
      `rather than only the bland common denominator. Do not just average genre tags — reason per-person about ` +
      `how each candidate would land for them specifically. For each pick, give your best-guess release year ` +
      `(used only to disambiguate remakes/same-titled films) and a reason noting which member(s) it serves and why.`
    : `A person's movie taste profile:\n${JSON.stringify(profiles[0], null, 2)}\n\n` +
      `Suggest ${REQUESTED_COUNT} real movies (not from any fixed list — use your own knowledge) that match ` +
      `this taste profile. For each, give your best-guess release year (used only to disambiguate ` +
      `remakes/same-titled films) and a one-sentence reason tied to their profile.`

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: isGroup ? 8000 : 4000,
    output_config: {
      effort: isGroup ? 'high' : 'medium',
      format: { type: 'json_schema', schema: PICKS_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          prompt +
          `\n\nThey've already seen (do not suggest any of these): ${JSON.stringify(excludedTitles)}`,
      },
    ],
  })

  return parseStructuredResponse<{ picks: Pick[] }>(response).picks
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
    })),
  )
}

// Returns null if the run doesn't exist or userId wasn't part of it (the
// requester or one of the invited members) — the dedicated
// /recommendations/:id page treats that as 404. Membership, not just
// ownership, matters now that other members get notified about group runs.
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
  const rows = await db.findMany(userRecommendations, { where: { run_id: runId }, orderBy: ['rank', 'asc'] })
  if (rows.length === 0) {
    return { id: run.id, createdAt: run.created_at, groupLabel, otherMemberLabels, results: [] }
  }

  const mediaItemIds = rows.map((row) => row.media_item_id)
  const [items, tagRows, interactionRows] = await Promise.all([
    db.findMany(mediaItems, { where: inList('id', mediaItemIds) }),
    db.findMany(mediaItemTags, { where: inList('media_item_id', mediaItemIds) }),
    db.findMany(userMediaInteractions, {
      where: and(eq('user_id', userId), inList('media_item_id', mediaItemIds)),
    }),
  ])
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const tagsByItemId = new Map<number, string[]>()
  for (const tagRow of tagRows) {
    const tags = tagsByItemId.get(tagRow.media_item_id) ?? []
    tags.push(tagRow.tag)
    tagsByItemId.set(tagRow.media_item_id, tags)
  }
  const statusByItemId = new Map<number, RecommendationResult['status']>(
    interactionRows.map((i) => [i.media_item_id, i.status]),
  )

  const results: RecommendationResult[] = []
  for (const row of rows) {
    const item = itemsById.get(row.media_item_id)
    if (!item) continue
    results.push({
      item,
      tags: tagsByItemId.get(item.id) ?? [],
      reason: row.reason,
      status: statusByItemId.get(item.id) ?? null,
    })
  }

  return { id: run.id, createdAt: run.created_at, groupLabel, otherMemberLabels, results }
}
