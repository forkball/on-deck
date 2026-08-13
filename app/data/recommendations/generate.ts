import { inList } from 'remix/data-table'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { isFollowing } from '../follows.ts'
import { countUserMediaLog, CONSUMPTION_STATUSES, type MediaType } from '../mediaItems.ts'
import { createNotification } from '../notifications.ts'
import { mediaItems, users } from '../schema.ts'
import { displayLabel } from '../users.ts'
import { recordRunAgainstDailyLimit } from './dailyLimit.ts'
import type { GenerationPhase } from './jobs.ts'
import {
  hasLengthDimension,
  lookupForType,
  matchesDecade,
  resolveFromCatalog,
  searchForType,
  titlesLikelyMatch,
  verifyPicksAgainstOverviews,
  withOverviews,
  type Candidate,
} from './matching.ts'
import {
  requestPicks,
  toTasteSummary,
  type ExcludedTitles,
  type MemberProfile,
  type MultiSourceMemberProfile,
  type Pick,
  type RecommendationFilters,
} from './picks.ts'
import {
  MAX_RUNS_PER_USER,
  pruneOldRuns,
  saveRun,
  type GenerationParams,
  type RecommendationResult,
} from './runs.ts'
import { ensureTasteProfile } from './tasteProfile.ts'

const TARGET_COUNT = 10

// What a partially-finished run has already bought. Small on purpose: ids, not
// objects — the rows they name are written before the checkpoint records them.
export interface GenerationCheckpoint {
  picks?: Pick[]
  verified?: { mediaItemId: number; reason: string }[]
}

export interface GenerateRecommendationsOutcome {
  runId: number
  // Whether this run pushed the user over MAX_RUNS_PER_USER.
  prunedOldestRun: boolean
}

export interface MissingSourceLogs {
  userId: number
  label: string
  // The requested source types this person has nothing logged under.
  missing: MediaType[]
}

// An empty log yields an empty taste profile, so the run would still generate
// while quietly ignoring that person — a "group" pick reflecting only whoever
// had logs. Callers block generation on a non-empty result.
export async function findMembersMissingSourceLogs(
  db: Db,
  memberUserIds: number[],
  sourceTypes: MediaType[],
): Promise<MissingSourceLogs[]> {
  const checked = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [user, counts] = await Promise.all([
        db.find(users, memberId),
        // Rejections don't count: a member whose log for a type is nothing but
        // "not interested" has given the profile nothing to work from, which
        // is exactly the case this check exists to catch.
        Promise.all(
          sourceTypes.map((type) => countUserMediaLog(db, memberId, { type, statuses: CONSUMPTION_STATUSES })),
        ),
      ])
      return {
        userId: memberId,
        label: user ? displayLabel(user) : `User ${memberId}`,
        missing: sourceTypes.filter((_, index) => counts[index] === 0),
      }
    }),
  )

  return checked.filter((entry) => entry.missing.length > 0)
}

// One dated run of picks, kept rather than replaced so it stays browsable at
// /recommendations/:id. Capped at MAX_RUNS_PER_USER, oldest pruned.
//
// The stages live next door — picks.ts asks the model, matching.ts resolves to
// catalog entries, runs.ts persists. This owns only their order and what a
// resume skips.
export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
  filters: RecommendationFilters = {},
  mediaType: MediaType = 'movie',
  // Independent of what's being generated — "movies based on my TV taste" is a
  // legitimate ask. Defaults to matching the output type.
  sourceTypes?: MediaType[],
  // Optional user-given label for the run, e.g. "Cozy weekend picks".
  name?: string,
  // Every call site sits immediately before the await it describes.
  onPhase: (phase: GenerationPhase) => void = () => {},
  // Resume support: a stage whose output is already in `checkpoint` is skipped,
  // so an interrupted run doesn't buy the same model call twice.
  checkpoint: GenerationCheckpoint = {},
  onCheckpoint: (checkpoint: GenerationCheckpoint) => void = () => {},
): Promise<GenerateRecommendationsOutcome> {
  const profileTypes: MediaType[] = sourceTypes && sourceTypes.length > 0 ? sourceTypes : [mediaType]

  // Each only costs a model call if that member's log has moved.
  onPhase('profiles')
  const members = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [regenerated, user] = await Promise.all([
        Promise.all(profileTypes.map((type) => ensureTasteProfile(db, memberId, type))),
        db.find(users, memberId),
      ])
      return { regenerated, label: user ? displayLabel(user) : `User ${memberId}` }
    }),
  )

  const profiles: MemberProfile[] | MultiSourceMemberProfile[] =
    profileTypes.length === 1
      ? members.map(({ regenerated, label }) => ({ label, ...toTasteSummary(regenerated[0]) }))
      : members.map(({ regenerated, label }) => ({
          label,
          ...Object.fromEntries(
            profileTypes.map((type, i) => [`${mediaTypeUiFor(type).plural}_taste`, toTasteSummary(regenerated[i])]),
          ),
        }))

  // Two reasons not to suggest something, kept apart because only one of them
  // says anything about taste. The id set is what actually enforces both — the
  // title lists are a prompt hint, and the model is free to ignore them.
  const excluded: ExcludedTitles = { seen: [], rejected: [] }
  const excludedExternalIds = new Set<string>()
  for (const { regenerated } of members) {
    for (const profile of regenerated) {
      for (const { interaction, item } of profile.log) {
        const titles =
          interaction.status === 'consumed'
            ? excluded.seen
            : interaction.status === 'not_interested'
              ? excluded.rejected
              : null
        // Wanting something, or being partway through it, is no reason to
        // withhold it — only the two statuses that are finished with it, one
        // way or the other, exclude anything.
        if (!titles) continue
        if (item?.title) titles.push(item.title)
        if (item?.external_id) excludedExternalIds.add(item.external_id)
      }
    }
  }

  // The most expensive call in a run, so the first worth never paying twice.
  let picks: Pick[]
  if (checkpoint.picks?.length) {
    picks = checkpoint.picks
  } else {
    onPhase('picks')
    picks = await requestPicks(profiles, excluded, filters, mediaType, profileTypes)
    checkpoint = { ...checkpoint, picks }
    onCheckpoint(checkpoint)
  }

  // Only what isn't already in the catalog costs a provider request.
  onPhase('matching')
  const fromCatalog = await resolveFromCatalog(mediaType, picks)

  const matchesByPick = await Promise.all(
    picks.map(async (pick, index) => {
      const local = fromCatalog.get(index)
      return local ? [local] : await searchForType(mediaType, pick.title)
    }),
  )

  // Only then does the loop below make a second round of requests.
  if (filters.length) onPhase('lengths')

  // Not capped at TARGET_COUNT: verification below drops some too, so the
  // over-request slack has to reach it or a verification drop under-fills the
  // run rather than spending slack already budgeted for it.
  const candidates: Candidate[] = []
  const seenExternalIds = new Set<string>()

  for (const [i, pick] of picks.entries()) {
    const matches: CatalogSearchResult[] = matchesByPick[i]
    if (matches.length === 0) continue

    const match =
      matches.find((m) => m.releaseYear === pick.year) ??
      [...matches].sort(
        (a, b) => Math.abs((a.releaseYear ?? 0) - pick.year) - Math.abs((b.releaseYear ?? 0) - pick.year),
      )[0]

    if (excludedExternalIds.has(match.externalId) || seenExternalIds.has(match.externalId)) continue
    if (!titlesLikelyMatch(pick.title, match.title)) continue
    if (filters.genre && !match.tags.includes(filters.genre)) continue
    if (filters.decade != null && !matchesDecade(match.releaseYear, filters.decade, filters.decadeRelation)) continue
    if (filters.playerType && !match.tags.includes(filters.playerType)) continue
    if (filters.multiplayerType && !match.tags.includes(filters.multiplayerType)) continue
    if (filters.series && !match.tags.includes(filters.series)) continue

    // No provider returns the length dimension on search, only on by-id — so
    // this extra round trip is paid only when the lever is set.
    let resolved = match
    if (filters.length) {
      // The stored row often already carries it, making the request pure cost.
      const provider = getCatalogProvider(mediaType)
      if (hasLengthDimension(mediaType, match)) {
        if (!provider.matchesLength(match, filters.length)) continue
        seenExternalIds.add(match.externalId)
        candidates.push({ pick, match })
        continue
      }

      const detail = await lookupForType(mediaType, match.externalId)
      if (!detail || !provider.matchesLength(detail, filters.length)) continue
      // Already paid for, and it carries what search omits. Keeping `match`
      // instead wrote rows with a null runtime it had just fetched.
      resolved = detail
    }

    seenExternalIds.add(match.externalId)
    candidates.push({ pick, match: resolved })
  }

  // A second, semantic pass over the survivors before anything is written.
  let results: RecommendationResult[]

  if (checkpoint.verified?.length) {
    // A previous attempt already paid for verification, and wrote its picks to
    // the catalog before recording them — so rebuild from those rows.
    const ids = checkpoint.verified.map((entry) => entry.mediaItemId)
    const items = await db.findMany(mediaItems, { where: inList('id', ids) })
    const itemsById = new Map(items.map((item) => [item.id, item]))

    onPhase('saving')
    results = []
    for (const entry of checkpoint.verified) {
      const item = itemsById.get(entry.mediaItemId)
      // Could have been merged away by a rematch since.
      if (!item) continue
      results.push({ item, reason: entry.reason, interaction: null })
    }
  } else {
    onPhase('verifying')
    const verified = await verifyPicksAgainstOverviews(await withOverviews(candidates, mediaType), mediaType)

    onPhase('saving')
    results = []
    for (const { pick, match } of verified.slice(0, TARGET_COUNT)) {
      const item = await upsertCatalogItem(db, mediaType, match)
      results.push({ item, reason: pick.reason, interaction: null })
    }

    // Ids, not objects — keeps a job row at a few KB.
    checkpoint = {
      ...checkpoint,
      verified: results.map((result) => ({ mediaItemId: result.item.id, reason: result.reason })),
    }
    onCheckpoint(checkpoint)
  }

  const runId = await saveRun(db, {
    requestingUserId,
    memberUserIds,
    mediaType,
    name,
    params: {
      genre: filters.genre,
      decade: filters.decade,
      decadeRelation: filters.decadeRelation,
      length: filters.length,
      playerType: filters.playerType,
      multiplayerType: filters.multiplayerType,
      series: filters.series,
      sourceTypes: profileTypes,
    } satisfies GenerationParams,
    results,
  })

  // Against the run that exists, not the request that asked for it — a run
  // that never made it this far cost the person nothing. See dailyLimit.ts.
  await recordRunAgainstDailyLimit(db, requestingUserId)

  await notifyMutualFollowers(db, requestingUserId, memberUserIds, runId)

  const prunedOldestRun = await pruneOldRuns(db, requestingUserId, mediaType)

  return { runId, prunedOldestRun }
}

// Only members who mutually follow the requester — the picker already requires
// one direction; this requires the follow back before pinging them.
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

      await createNotification(db, { userId: memberId, actorUserId: requestingUserId, type: 'recommendation', runId })
    }),
  )
}
