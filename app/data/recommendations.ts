import { inList } from 'remix/data-table'

import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from './db.ts'
import { upsertMovie } from './movies.ts'
import { mediaItems, mediaItemTags, users, userRecommendations, type MediaItem } from './schema.ts'
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
}

export interface RecommendationBatch {
  results: RecommendationResult[]
  groupLabel: string | null
}

export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
): Promise<RecommendationBatch> {
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
      if (interaction.status !== 'consumed' && interaction.status !== 'dropped') continue
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
    results.push({ item, tags: match.tags, reason: pick.reason })
  }

  const otherMembers = members.filter((_, i) => memberUserIds[i] !== requestingUserId)
  const groupLabel = otherMembers.length > 0 ? `You + ${otherMembers.map((m) => m.label).join(', ')}` : null

  await db.deleteMany(userRecommendations, { where: { user_id: requestingUserId } })
  const now = Date.now()
  for (const [index, result] of results.entries()) {
    await db.create(userRecommendations, {
      user_id: requestingUserId,
      media_item_id: result.item.id,
      reason: result.reason,
      rank: index + 1,
      group_label: groupLabel ?? undefined,
      created_at: now,
    })
  }

  return { results, groupLabel }
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

export async function listRecommendations(db: Db, userId: number): Promise<RecommendationBatch> {
  const rows = await db.findMany(userRecommendations, {
    where: { user_id: userId },
    orderBy: ['rank', 'asc'],
  })
  if (rows.length === 0) return { results: [], groupLabel: null }

  const mediaItemIds = rows.map((row) => row.media_item_id)
  const [items, tagRows] = await Promise.all([
    db.findMany(mediaItems, { where: inList('id', mediaItemIds) }),
    db.findMany(mediaItemTags, { where: inList('media_item_id', mediaItemIds) }),
  ])
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const tagsByItemId = new Map<number, string[]>()
  for (const tagRow of tagRows) {
    const tags = tagsByItemId.get(tagRow.media_item_id) ?? []
    tags.push(tagRow.tag)
    tagsByItemId.set(tagRow.media_item_id, tags)
  }

  const results: RecommendationResult[] = []
  for (const row of rows) {
    const item = itemsById.get(row.media_item_id)
    if (!item) continue
    results.push({ item, tags: tagsByItemId.get(item.id) ?? [], reason: row.reason })
  }
  return { results, groupLabel: rows[0]?.group_label ?? null }
}
