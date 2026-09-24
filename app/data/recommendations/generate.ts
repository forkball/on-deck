import { inList } from 'remix/data-table'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { platformFamilies } from '../catalog/igdb.ts'
import { upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import { isFollowing } from '../follows.ts'
import { countUserMediaLog, listUserMediaLog, CONSUMPTION_STATUSES, type MediaType } from '../mediaItems.ts'
import { createNotification } from '../notifications.ts'
import { mediaItems, users } from '../schema.ts'
import { displayLabel } from '../users.ts'
import { recordRunAgainstDailyLimit, runCostFor } from './dailyLimit.ts'
import { GenerationError } from './errors.ts'
import { buildExclusions } from './exclusions.ts'
import { phasesFor, type GenerationPhase } from './jobs.ts'
import {
  decadeYear,
  filterByGenre,
  filterByLength,
  matchesDecade,
  matchesSeries,
  resolveFromCatalog,
  searchForPicks,
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
import { emptyDrops, logPickTally, type PickTally } from './tally.ts'
import { finishTranscript, startTranscript } from './transcripts.ts'
import { ensureTasteProfile, profileSettingsFor } from './tasteProfile.ts'
import { markPhase, track } from './timings.ts'

// Which levers a run was narrowed by, in the words the form used for them, so the
// advice names the thing there is a control for.
const FILTER_LABELS: [keyof RecommendationFilters, string][] = [
  ['genre', 'genre'],
  ['decade', 'decade'],
  ['length', 'length'],
  ['playerType', 'player type'],
  ['multiplayerType', 'multiplayer type'],
  ['platform', 'platform'],
  ['series', 'series'],
]

// Exported for its own test: the levers are read off a shape that grows, and copy
// that forgets one sends somebody looking for a filter it never mentions.
export function nothingLeftMessage(filters: RecommendationFilters, mediaType: MediaType): string {
  const noun = mediaTypeUiFor(mediaType).plural
  const set = FILTER_LABELS.filter(([key]) => filters[key] != null).map(([, label]) => label)

  if (set.length === 0) {
    return `Nothing came back that we could confirm this time. Try generating again.`
  }

  const list = set.length === 1 ? set[0] : `${set.slice(0, -1).join(', ')} and ${set[set.length - 1]}`
  return (
    `No ${noun} made it through the ${list} ${set.length === 1 ? 'filter' : 'filters'}. ` +
    `Try widening ${set.length === 1 ? 'it' : 'them'} and generating again.`
  )
}

// Exported so the page can say how many a run comes back with rather than
// restating the number in copy that would then drift from it.
export const TARGET_COUNT = 8

// What "I'm feeling lucky" means at this end of the pipeline: one pick, the
// top-ranked one. Everything before this stage is unchanged — the same number of
// picks is asked for and put through the same gates, because the drops are what
// make one survivor likely rather than a coin toss.
const LUCKY_TARGET_COUNT = 1

// Ids, not objects: the rows they name are written before the checkpoint
// records them, and a job row has to stay small.
export interface GenerationCheckpoint {
  picks?: Pick[]
  verified?: { mediaItemId: number; reason: string }[]
}

export interface GenerateOptions {
  // An "I'm feeling lucky" run: one pick instead of eight, nothing anyone in the
  // group has logged, and charged to its own once-a-day cap rather than the
  // general allowance. Same queue, same stages, same tables.
  lucky?: boolean
  // The job this run is being made for, recorded on its transcript so a run can be
  // traced back from the queue.
  jobId?: string
}

// A run, or the model's own answer kept when nothing could confirm it. Callers
// have to look at which, because the two land on different pages.
export type GenerateRecommendationsOutcome =
  | { kind: 'run'; runId: number; prunedOldestRun: boolean }
  | { kind: 'unconfirmed'; unconfirmedRunId: number }

export interface MissingSourceLogs {
  userId: number
  label: string
  missing: MediaType[]
}

// Callers must block generation on a non-empty result: an empty log yields an
// empty profile, and the run would silently ignore that person.
export async function findMembersMissingSourceLogs(
  db: Db,
  memberUserIds: number[],
  sourceTypes: MediaType[],
): Promise<MissingSourceLogs[]> {
  const checked = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [user, counts] = await Promise.all([
        db.find(users, memberId),
        // Rejections don't count — a log of nothing but "not interested" gives
        // the profile nothing to work from.
        Promise.all(
          sourceTypes.map((type) =>
            countUserMediaLog(db, memberId, { type, statuses: CONSUMPTION_STATUSES }),
          ),
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

export async function generateRecommendations(
  db: Db,
  requestingUserId: number,
  memberUserIds: number[],
  filters: RecommendationFilters = {},
  mediaType: MediaType = 'movie',
  // Independent of what's being generated. Defaults to the output type.
  sourceTypes?: MediaType[],
  name?: string,
  onPhase: (phase: GenerationPhase) => void = () => {},
  // A stage whose output is already in `checkpoint` is skipped, so an
  // interrupted run doesn't buy the same model call twice.
  checkpoint: GenerationCheckpoint = {},
  onCheckpoint: (checkpoint: GenerationCheckpoint) => void = () => {},
  // An object rather than an eleventh positional: `lucky` is not a parameter of
  // the same kind as the ones above it, and the list is long enough already.
  // Anything else that changes the shape of a run rather than its content
  // belongs here too.
  options: GenerateOptions = {},
): Promise<GenerateRecommendationsOutcome> {
  const lucky = options.lucky === true
  const profileTypes: MediaType[] = sourceTypes && sourceTypes.length > 0 ? sourceTypes : [mediaType]

  // Both announcements go through here, or a new stage gets measured as part of
  // the last one that forgot to close.
  const enterPhase = (phase: GenerationPhase): void => {
    markPhase(phase)
    onPhase(phase)
  }

  enterPhase('profiles')
  const members = await Promise.all(
    memberUserIds.map(async (memberId) => {
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
            profileTypes.map((type, i) => [
              `${mediaTypeUiFor(type).plural}_taste`,
              toTasteSummary(regenerated[i]),
            ]),
          ),
        }))

  // Must come from the log of the type being *generated*, not the types the
  // taste was read from: only the output type's ids can match the hard filter
  // below, so drawing this from the source logs lets a cross-media run
  // recommend something already watched and rated.
  const outputTypeIndex = profileTypes.indexOf(mediaType)
  const exclusionLogs = await Promise.all(
    members.map(({ regenerated }, index) =>
      outputTypeIndex >= 0
        ? regenerated[outputTypeIndex].log
        : track('log.exclusions', () => listUserMediaLog(db, memberUserIds[index], { type: mediaType })),
    ),
  )

  const { titles: excluded, externalIds: excludedExternalIds } = buildExclusions(exclusionLogs, { lucky })

  let picks: Pick[]
  // Null on a resumed run: the model was asked on the attempt before this one, and
  // that attempt kept its own transcript.
  let transcriptId: number | null = null
  if (checkpoint.picks?.length) {
    picks = checkpoint.picks
  } else {
    enterPhase('picks')
    const asked = await requestPicks(profiles, excluded, filters, mediaType, profileTypes)
    picks = asked.picks
    // Before anything is done with the answer, so a run that dies in the stages
    // below still leaves what was asked and what came back.
    transcriptId = await startTranscript(db, {
      userId: requestingUserId,
      jobId: options.jobId,
      mediaType,
      filters,
      prompt: asked.prompt,
      response: asked.response,
    }).catch((error) => {
      console.warn('[generation] transcript could not be started:', error)
      return null
    })
    checkpoint = { ...checkpoint, picks }
    onCheckpoint(checkpoint)
  }

  enterPhase('matching')
  const fromCatalog = await resolveFromCatalog(mediaType, picks)

  const matchesByPick = await searchForPicks(mediaType, picks, fromCatalog)

  // Not capped at TARGET_COUNT: verification below drops some too, so the
  // over-request slack has to reach it.
  const shortlist: Candidate[] = []
  const seenExternalIds = new Set<string>()
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
    // Genre is checked after this loop, not in it: for books the search hit
    // can't answer it. `series` is checked against the pick's own label, since no
    // catalog carries the answer — see matchesSeries.
    if (
      (filters.decade != null &&
        !matchesDecade(decadeYear(mediaType, pick, match), filters.decade, filters.decadeRelation)) ||
      (filters.playerType && !match.tags.includes(filters.playerType)) ||
      (filters.multiplayerType && !match.tags.includes(filters.multiplayerType)) ||
      // Platforms are their own field, not tags, and compare by family.
      (filters.platform && !platformFamilies(match.platforms ?? []).includes(filters.platform)) ||
      (filters.series && !matchesSeries(pick, filters.series))
    ) {
      drops.filtered++
      continue
    }

    seenExternalIds.add(match.externalId)
    shortlist.push({ pick, match })
  }

  let candidates: Candidate[] = shortlist
  if (filters.genre) {
    // The same function the job's phase list was built from, so a stage entered
    // here is a stage that list holds.
    if (phasesFor({ mediaType, filters }).includes('genres')) enterPhase('genres')
    const inGenre = await filterByGenre(candidates, mediaType, filters.genre)
    drops.genre = candidates.length - inGenre.length
    candidates = inGenre
  }
  if (filters.length) {
    enterPhase('lengths')
    const atLength = await filterByLength(candidates, mediaType, filters.length)
    drops.length = candidates.length - atLength.length
    candidates = atLength
  }

  let results: RecommendationResult[]
  let tally: PickTally | null = null

  if (checkpoint.verified?.length) {
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
    // Promise.all keeps pick order, which is the order they're ranked in.
    results = await Promise.all(
      verified.slice(0, lucky ? LUCKY_TARGET_COUNT : TARGET_COUNT).map(async ({ pick, match }) => ({
        item: await track('catalog.upsert', () => upsertCatalogItem(db, mediaType, match)),
        reason: pick.reason,
        interaction: null,
      })),
    )

    checkpoint = {
      ...checkpoint,
      verified: results.map((result) => ({ mediaItemId: result.item.id, reason: result.reason })),
    }
    onCheckpoint(checkpoint)

    // Only on this path — a resumed run skipped verification, and a tally
    // missing a stage reads as though everything was counted.
    tally = {
      requested: picks.length,
      kept: results.length,
      surplus: verified.length - results.length,
      dropped: drops,
    }
    logPickTally(tally)
  }

  // A run with nothing in it is not a run. Saving one spends the day's allowance,
  // takes one of the three slots a person keeps, prunes the oldest real run to make
  // room for it, and notifies them that their recommendations are ready — all for a
  // page with nothing on it. Every gate between the picks and here is a filter they
  // set, so the useful answer is which one to loosen, not an empty list.
  //
  // Thrown rather than returned: failJob puts a GenerationError's message in front
  // of whoever is waiting, and the job lands as failed rather than as a completed
  // run that isn't one.
  if (results.length === 0) {
    // Before the throw: an empty run is the case most worth being able to read
    // afterwards, and it leaves no run row to hang the numbers off.
    if (transcriptId != null && tally) await finishTranscript(db, transcriptId, { tally })
    throw new GenerationError(nothingLeftMessage(filters, mediaType))
  }

  const runId = await track('run.save', () =>
    saveRun(db, {
      requestingUserId,
      memberUserIds,
      mediaType,
      name,
      lucky,
      params: {
        genre: filters.genre,
        decade: filters.decade,
        decadeRelation: filters.decadeRelation,
        length: filters.length,
        playerType: filters.playerType,
        multiplayerType: filters.multiplayerType,
        platform: filters.platform,
        series: filters.series,
        sourceTypes: profileTypes,
      } satisfies GenerationParams,
      results,
    }),
  )

  // Usage is counted here, against the run that exists, not against the request:
  // a run that never made it this far cost nothing.
  //
  // A lucky run is not charged to the general allowance, and does not need a
  // ledger row of its own: the run it just saved is the record that the day's
  // pick has been drawn — see lucky.ts. Charging it to both would make one click
  // cost two things, and let a spent general allowance block the button whose
  // whole point is that it takes no thought.
  const [, , prunedOldestRun] = await Promise.all([
    lucky
      ? Promise.resolve()
      : track('run.usage', () =>
          recordRunAgainstDailyLimit(db, requestingUserId, runCostFor(memberUserIds.length)),
        ),
    track('run.notify', () => notifyMutualFollowers(db, requestingUserId, memberUserIds, runId)),
    track('run.prune', () => pruneOldRuns(db, requestingUserId, mediaType, { lucky })),
  ])

  // Off the critical path deliberately: nobody's run should fail over its own
  // record of itself, which is why finishTranscript swallows its errors.
  if (transcriptId != null && tally) await finishTranscript(db, transcriptId, { runId, tally })

  return { kind: 'run', runId, prunedOldestRun }
}

// Mutual follows only — the picker requires one direction, this requires the
// follow back before pinging anyone.
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

      await createNotification(db, {
        userId: memberId,
        actorUserId: requestingUserId,
        type: 'recommendation',
        runId,
      })
    }),
  )
}
