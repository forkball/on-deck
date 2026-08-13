import { inList } from 'remix/data-table'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { isFollowing } from '../follows.ts'
import { countUserMediaLog, listUserMediaLog, CONSUMPTION_STATUSES, type MediaType } from '../mediaItems.ts'
import { createNotification } from '../notifications.ts'
import { mediaItems, users } from '../schema.ts'
import { displayLabel } from '../users.ts'
import { recordRunAgainstDailyLimit } from './dailyLimit.ts'
import type { GenerationPhase } from './jobs.ts'
import {
  filterByLength,
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
import { emptyDrops, logPickTally } from './tally.ts'
import { ensureTasteProfile, profileSettingsFor } from './tasteProfile.ts'
import { markPhase, track } from './timings.ts'

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

  // Every stage announces itself twice — to whoever is watching the run, and
  // to the timings — and the two must not drift apart. Going through one
  // helper is what keeps a new stage from being measured as part of the last
  // one it forgot to close.
  const enterPhase = (phase: GenerationPhase): void => {
    markPhase(phase)
    onPhase(phase)
  }

  // Each only costs a model call if that member's log has moved.
  enterPhase('profiles')
  const members = await Promise.all(
    memberUserIds.map(async (memberId) => {
      // The user row comes first now rather than alongside: each member's own
      // settings decide what their profile is written from, so there's nothing
      // to build until it's here.
      const user = await db.find(users, memberId)
      const settings = user
        ? profileSettingsFor(user)
        : // A member who has since been deleted still has profiles on file;
          // reading them under the defaults beats failing the whole run.
          { logLimit: null, useNotes: true }

      const regenerated = await Promise.all(
        profileTypes.map((type) => ensureTasteProfile(db, memberId, type, settings)),
      )
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

  // What not to suggest comes from the log of the type being *generated*, not
  // the types the taste was read from — the two differ whenever someone asks
  // for one medium based on another.
  //
  // Drawing it from the source logs, as this used to, got the common case
  // right only because source and output are usually the same type. Ask for
  // movies from book taste and it excluded books: ids from another provider,
  // so the hard filter below could never match one, leaving the output type's
  // own log unconsulted and its films free to be recommended back to someone
  // who had already watched and rated them.
  //
  // Nothing of the source log is lost by this. Its signal is the taste profile
  // — that is what a profile is — and its titles would only mislead here,
  // since an adaptation shares a name with a book that is not the same thing
  // to watch.
  const outputTypeIndex = profileTypes.indexOf(mediaType)
  const exclusionLogs = await Promise.all(
    members.map(({ regenerated }, index) =>
      // Already in hand whenever the output type is one of the sources, which
      // is every run that doesn't cross media.
      outputTypeIndex >= 0
        ? regenerated[outputTypeIndex].log
        : track('log.exclusions', () => listUserMediaLog(db, memberUserIds[index], { type: mediaType })),
    ),
  )

  // Two reasons not to suggest something, kept apart because only one of them
  // says anything about taste. The id set is what actually enforces both — the
  // title lists are a prompt hint, and the model is free to ignore them.
  const excluded: ExcludedTitles = { seen: [], rejected: [] }
  const excludedExternalIds = new Set<string>()
  for (const log of exclusionLogs) {
    for (const { interaction, item } of log) {
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

  // The most expensive call in a run, so the first worth never paying twice.
  let picks: Pick[]
  if (checkpoint.picks?.length) {
    picks = checkpoint.picks
  } else {
    enterPhase('picks')
    picks = await requestPicks(profiles, excluded, filters, mediaType, profileTypes)
    checkpoint = { ...checkpoint, picks }
    onCheckpoint(checkpoint)
  }

  // Only what isn't already in the catalog costs a provider request.
  enterPhase('matching')
  const fromCatalog = await resolveFromCatalog(mediaType, picks)

  const matchesByPick = await Promise.all(
    picks.map(async (pick, index) => {
      const local = fromCatalog.get(index)
      return local ? [local] : await searchForType(mediaType, pick.title)
    }),
  )

  // Everything that can be decided from the search results already in hand.
  // Nothing here makes a request, so the dedupe settles in pick order rather
  // than in whatever order a provider answered.
  //
  // Not capped at TARGET_COUNT: verification below drops some too, so the
  // over-request slack has to reach it or a verification drop under-fills the
  // run rather than spending slack already budgeted for it.
  const shortlist: Candidate[] = []
  const seenExternalIds = new Set<string>()
  // Counted, not stored — see tally.ts for why this is log-only for now.
  const drops = emptyDrops()

  for (const [i, pick] of picks.entries()) {
    const matches: CatalogSearchResult[] = matchesByPick[i]
    if (matches.length === 0) {
      drops.unfound++
      continue
    }

    const match =
      matches.find((m) => m.releaseYear === pick.year) ??
      [...matches].sort(
        (a, b) => Math.abs((a.releaseYear ?? 0) - pick.year) - Math.abs((b.releaseYear ?? 0) - pick.year),
      )[0]

    // Split apart from each other, where they used to share a condition. They
    // read the same to the pipeline and mean opposite things to us: one says
    // the model suggested something this person has finished with, the other
    // says it suggested the same entry twice in one run.
    if (excludedExternalIds.has(match.externalId)) {
      drops.alreadyLogged++
      continue
    }
    if (seenExternalIds.has(match.externalId)) {
      drops.duplicate++
      continue
    }
    if (!titlesLikelyMatch(pick.title, match.title)) {
      drops.titleMismatch++
      continue
    }
    if (
      (filters.genre && !match.tags.includes(filters.genre)) ||
      (filters.decade != null && !matchesDecade(match.releaseYear, filters.decade, filters.decadeRelation)) ||
      (filters.playerType && !match.tags.includes(filters.playerType)) ||
      (filters.multiplayerType && !match.tags.includes(filters.multiplayerType)) ||
      (filters.series && !match.tags.includes(filters.series))
    ) {
      drops.filtered++
      continue
    }

    // Marked before the length verdict, unlike the loop this replaces, which
    // left a length-rejected entry unmarked and re-tested the next pick
    // resolving to the same id. Same id, same verdict — so the only thing that
    // cost was the second lookup.
    seenExternalIds.add(match.externalId)
    shortlist.push({ pick, match })
  }

  // The only filter that can't be answered from what search returned, so it's
  // the only one that costs a second round of requests.
  let candidates: Candidate[] = shortlist
  if (filters.length) {
    enterPhase('lengths')
    candidates = await filterByLength(shortlist, mediaType, filters.length)
    // Subtraction, not instrumentation: the stage takes a list and hands back
    // a shorter one, so the difference is the count.
    drops.length = shortlist.length - candidates.length
  }

  // A second, semantic pass over the survivors before anything is written.
  let results: RecommendationResult[]

  if (checkpoint.verified?.length) {
    // A previous attempt already paid for verification, and wrote its picks to
    // the catalog before recording them — so rebuild from those rows.
    const ids = checkpoint.verified.map((entry) => entry.mediaItemId)
    const items = await db.findMany(mediaItems, { where: inList('id', ids) })
    const itemsById = new Map(items.map((item) => [item.id, item]))

    enterPhase('saving')
    results = []
    for (const entry of checkpoint.verified) {
      const item = itemsById.get(entry.mediaItemId)
      // Could have been merged away by a rematch since.
      if (!item) continue
      results.push({ item, reason: entry.reason, interaction: null })
    }
  } else {
    enterPhase('verifying')
    const verified = await verifyPicksAgainstOverviews(await withOverviews(candidates, mediaType), mediaType)
    drops.unverified = candidates.length - verified.length

    enterPhase('saving')
    // Concurrent: these are ten independent rows, and the search page already
    // fans out about twice this many upserts at once. Promise.all keeps them
    // in pick order, which is the order they're ranked in.
    results = await Promise.all(
      verified.slice(0, TARGET_COUNT).map(async ({ pick, match }) => ({
        item: await track('catalog.upsert', () => upsertCatalogItem(db, mediaType, match)),
        reason: pick.reason,
        interaction: null,
      })),
    )

    // Ids, not objects — keeps a job row at a few KB.
    checkpoint = {
      ...checkpoint,
      verified: results.map((result) => ({ mediaItemId: result.item.id, reason: result.reason })),
    }
    onCheckpoint(checkpoint)

    // Only on this path. A run resuming from a checkpoint skipped verification
    // entirely, so its gates never all ran — and a tally missing a stage is
    // worse than none, since it reads as though everything was counted.
    logPickTally({
      requested: picks.length,
      kept: results.length,
      surplus: verified.length - results.length,
      dropped: drops,
    })
  }

  const runId = await track('run.save', () =>
    saveRun(db, {
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
    }),
  )

  // All three run once the picks exist, with the requester still on the
  // waiting page, and none of them reads what the others write — so they
  // overlap rather than queueing.
  //
  // Usage is counted against the run that exists, not the request that asked
  // for it: a run that never made it this far cost the person nothing. See
  // dailyLimit.ts.
  //
  // Timed apart because they aren't equally load-bearing. If these turn out to
  // cost anything, notifying is the one that can move behind the redirect,
  // being best-effort either way — where a ledger write that doesn't land is a
  // run nobody was charged for.
  const [, , prunedOldestRun] = await Promise.all([
    track('run.usage', () => recordRunAgainstDailyLimit(db, requestingUserId)),
    track('run.notify', () => notifyMutualFollowers(db, requestingUserId, memberUserIds, runId)),
    track('run.prune', () => pruneOldRuns(db, requestingUserId, mediaType)),
  ])

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
