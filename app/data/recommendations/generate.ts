import { inList } from 'remix/data-table'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { isFollowing } from '../follows.ts'
import { countUserMediaLog, type MediaType } from '../mediaItems.ts'
import { createNotification } from '../notifications.ts'
import { mediaItems, users } from '../schema.ts'
import { displayLabel } from '../users.ts'
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

// What a partially-finished run has already bought. Deliberately small: the
// picks list, then ids — the catalog rows those ids name are written before
// the checkpoint records them.
export interface GenerationCheckpoint {
  picks?: Pick[]
  verified?: { mediaItemId: number; reason: string }[]
}

export interface GenerateRecommendationsOutcome {
  runId: number
  // Whether generating this run pushed the user over MAX_RUNS_PER_USER and
  // caused their oldest run to be deleted.
  prunedOldestRun: boolean
}

export interface MissingSourceLogs {
  userId: number
  label: string
  // The requested source types this person has nothing logged under.
  missing: MediaType[]
}

// Finds anyone in a proposed run who has an empty log for one of the taste
// profiles the run would be based on. regenerateTasteProfile happily returns
// an empty profile in that case, so without this the run still generates —
// it just quietly ignores that person, and a "group" pick ends up reflecting
// only whoever actually had logs. Callers block generation on a non-empty
// result rather than producing something that only looks personalized.
export async function findMembersMissingSourceLogs(
  db: Db,
  memberUserIds: number[],
  sourceTypes: MediaType[],
): Promise<MissingSourceLogs[]> {
  const checked = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [user, counts] = await Promise.all([
        db.find(users, memberId),
        Promise.all(sourceTypes.map((type) => countUserMediaLog(db, memberId, type))),
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

// Generates one indexed, dated run of picks and returns its id — history is
// kept (never replaced), so every run stays browsable at /recommendations/:id.
// Runs are capped at MAX_RUNS_PER_USER per user; generating past the cap
// deletes the oldest run (cascading to its members/results).
//
// The stages themselves live next door: picks.ts asks the model, matching.ts
// turns those picks into catalog entries, runs.ts persists the result. This
// function owns only the order they happen in, and what gets skipped on resume.
export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
  filters: RecommendationFilters = {},
  mediaType: MediaType = 'movie',
  // Which taste profile(s) the picks are based on. Independent of what's
  // being generated — "recommend me movies based on my TV taste" is a
  // legitimate ask. Defaults to matching the output type.
  sourceTypes?: MediaType[],
  // Optional user-given label for the run, e.g. "Cozy weekend picks".
  name?: string,
  // Called as each stage begins, so a waiting page can say what's happening
  // instead of guessing. Every call site here sits immediately before the
  // await it describes.
  onPhase: (phase: GenerationPhase) => void = () => {},
  // Resume support. `checkpoint` is whatever a previous attempt recorded;
  // `onCheckpoint` is how this one records its own. A stage whose output is
  // already present is skipped, so an interrupted run doesn't buy the same
  // model call twice.
  checkpoint: GenerationCheckpoint = {},
  onCheckpoint: (checkpoint: GenerationCheckpoint) => void = () => {},
): Promise<GenerateRecommendationsOutcome> {
  const profileTypes: MediaType[] = sourceTypes && sourceTypes.length > 0 ? sourceTypes : [mediaType]

  // Independent per member — refresh every profile (and fetch their name)
  // concurrently. Each one only costs a model call if that member's log has
  // changed since it was last written; otherwise the stored profile is reused.
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

  const excludedTitles: string[] = []
  const excludedExternalIds = new Set<string>()
  for (const { regenerated } of members) {
    for (const profile of regenerated) {
      for (const { interaction, item } of profile.log) {
        if (interaction.status !== 'consumed') continue
        if (item?.title) excludedTitles.push(item.title)
        if (item?.external_id) excludedExternalIds.add(item.external_id)
      }
    }
  }

  // The most expensive single call in a run, so it is the first thing worth
  // never paying for twice.
  let picks: Pick[]
  if (checkpoint.picks?.length) {
    picks = checkpoint.picks
  } else {
    onPhase('picks')
    picks = await requestPicks(profiles, excludedTitles, filters, mediaType, profileTypes)
    checkpoint = { ...checkpoint, picks }
    onCheckpoint(checkpoint)
  }

  // Anything already in the catalog is resolved without leaving the process;
  // only the rest cost a provider request.
  onPhase('matching')
  const fromCatalog = await resolveFromCatalog(mediaType, picks)

  const matchesByPick = await Promise.all(
    picks.map(async (pick, index) => {
      const local = fromCatalog.get(index)
      return local ? [local] : await searchForType(mediaType, pick.title)
    }),
  )

  // Only reported when a length lever is set, because only then does the loop
  // below make a second round of requests.
  if (filters.length) onPhase('lengths')

  // Deliberately not capped at TARGET_COUNT here — verifyPicksAgainstOverviews
  // below drops some of these too, so the same over-request slack that
  // covers dedup/filter misses needs to reach verification as well, or a
  // verification drop would under-fill the run instead of just consuming
  // slack that was already budgeted for exactly this.
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
    if (filters.decade != null && !matchesDecade(match.releaseYear, filters.decade)) continue

    // The length dimension isn't in search results for any provider — only
    // the by-id lookup carries it — so this only pays for the extra round
    // trip when a length lever is actually set. The provider decides what
    // "short" means in its own units.
    let resolved = match
    if (filters.length) {
      // The stored row often already carries the dimension this filter reads —
      // runtime, page count, hours to beat — in which case the provider has
      // nothing to add and the request is pure cost.
      const provider = getCatalogProvider(mediaType)
      if (hasLengthDimension(mediaType, match)) {
        if (!provider.matchesLength(match, filters.length)) continue
        seenExternalIds.add(match.externalId)
        candidates.push({ pick, match })
        continue
      }

      const detail = await lookupForType(mediaType, match.externalId)
      if (!detail || !provider.matchesLength(detail, filters.length)) continue
      // Keep the detail rather than discarding it. We've already paid for the
      // request, and it carries everything search omits — runtime/page count,
      // the credit, and (for books) the description. Storing `match` instead
      // meant a filtered run wrote rows with a null runtime it had just
      // fetched, and left the detail page to re-request it later.
      resolved = detail
    }

    seenExternalIds.add(match.externalId)
    candidates.push({ pick, match: resolved })
  }

  // Title similarity can't tell two different films apart when they share
  // both title and year — only content can, so this is a second, semantic
  // pass over the survivors before anything gets written to the catalog.
  let results: RecommendationResult[]

  if (checkpoint.verified?.length) {
    // A previous attempt already paid for verification. Its picks were written
    // to the catalog before the checkpoint recorded them, so this rebuilds the
    // same output from those rows instead of asking the model again.
    const ids = checkpoint.verified.map((entry) => entry.mediaItemId)
    const items = await db.findMany(mediaItems, { where: inList('id', ids) })
    const itemsById = new Map(items.map((item) => [item.id, item]))

    onPhase('saving')
    results = []
    for (const entry of checkpoint.verified) {
      const item = itemsById.get(entry.mediaItemId)
      // A row could have been merged away by a rematch since; skip rather
      // than fail the resumed run over it.
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

    // Recorded as ids, not objects — the catalog rows are already written, so
    // the checkpoint only has to name them. Keeps a job row at a few KB.
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
      length: filters.length,
      sourceTypes: profileTypes,
    } satisfies GenerationParams,
    results,
  })

  await notifyMutualFollowers(db, requestingUserId, memberUserIds, runId)

  const prunedOldestRun = await pruneOldRuns(db, requestingUserId, mediaType)

  return { runId, prunedOldestRun }
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

      await createNotification(db, { userId: memberId, actorUserId: requestingUserId, type: 'recommendation', runId })
    }),
  )
}
