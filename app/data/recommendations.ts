import { and, eq, inList } from 'remix/data-table'

import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from './db.ts'
import { upsertMovie } from './movies.ts'
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
  results: RecommendationResult[]
}

async function buildGroupLabel(db: Db, requestingUserId: number, run: RecommendationRun): Promise<string> {
  const memberRows = await db.findMany(recommendationRunMembers, { where: { run_id: run.id } })
  const otherMemberIds = memberRows.map((m) => m.user_id).filter((id) => id !== requestingUserId)
  if (otherMemberIds.length === 0) return 'Just you'

  const otherUsers = await db.findMany(users, { where: inList('id', otherMemberIds) })
  return `You + ${otherUsers.map(displayLabel).join(', ')}`
}

// Generates one indexed, dated run of picks and returns its id — history is
// kept (never replaced), so every run stays browsable at /recommendations/:id.
export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
): Promise<number> {
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

  return run.id
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

// Returns null if the run doesn't exist or doesn't belong to userId — the
// dedicated /recommendations/:id page treats that as 404.
export async function getRecommendationRun(
  db: Db,
  runId: number,
  userId: number,
): Promise<RecommendationRunDetail | null> {
  const run = await db.find(recommendationRuns, runId)
  if (!run || run.user_id !== userId) return null

  const groupLabel = await buildGroupLabel(db, userId, run)
  const rows = await db.findMany(userRecommendations, { where: { run_id: runId }, orderBy: ['rank', 'asc'] })
  if (rows.length === 0) return { id: run.id, createdAt: run.created_at, groupLabel, results: [] }

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

  return { id: run.id, createdAt: run.created_at, groupLabel, results }
}
