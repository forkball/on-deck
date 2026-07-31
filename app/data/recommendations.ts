import { and, eq, inList } from 'remix/data-table'

import { claude, parseStructuredResponse } from './claude.ts'
import type { Db } from './db.ts'
import { isFollowing } from './follows.ts'
import { upsertMediaItem, type MediaType } from './mediaCatalog.ts'
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
import { getMovieById, getTvShowById, searchMovies, searchTv, type TmdbSearchResult } from './tmdb.ts'
import { regenerateTasteProfile } from './tasteProfile.ts'
import { displayLabel } from './users.ts'

// A run can target one media type, or deliberately span movies + TV
// ('mixed'), where every pick carries its own type.
export type RunMediaType = MediaType | 'mixed'

const MEDIA_NOUNS: Record<RunMediaType, string> = {
  movie: 'movies',
  tv: 'TV shows',
  book: 'books',
  comic: 'comics',
  game: 'games',
  mixed: 'movies and TV shows',
}

function toTasteSummary(profile: { summary: string; liked_tags: string[]; disliked_tags: string[] }): TasteSummary {
  return { summary: profile.summary, liked_tags: profile.liked_tags, disliked_tags: profile.disliked_tags }
}

function searchForType(mediaType: MediaType, query: string): Promise<TmdbSearchResult[]> {
  return mediaType === 'tv' ? searchTv(query) : searchMovies(query)
}

function lookupForType(mediaType: MediaType, externalId: string): Promise<TmdbSearchResult | null> {
  return mediaType === 'tv' ? getTvShowById(externalId) : getMovieById(externalId)
}

interface TasteSummary {
  summary: string
  liked_tags: string[]
  disliked_tags: string[]
}

interface MemberProfile extends TasteSummary {
  label: string
}

// When picks are based on more than one taste profile, each member's
// profiles stay separate and labeled by type, so Claude can reason about
// "this person's movie taste vs their TV taste" rather than being handed
// one blurred-together profile.
interface MultiSourceMemberProfile {
  label: string
  [sourceLabel: string]: TasteSummary | string
}

// Built per-run rather than fixed: a mixed run additionally requires each
// pick to declare whether it's a movie or a TV show, since that decides
// which TMDB endpoint resolves it. Structured-output schemas are strict
// (additionalProperties: false), so the field can't just be optional —
// it's present and required only when it's actually meaningful.
function buildPicksSchema(mixed: boolean) {
  const properties: Record<string, unknown> = {
    title: { type: 'string' as const },
    year: { type: 'number' as const },
    reason: { type: 'string' as const },
  }
  const required = ['title', 'year', 'reason']

  if (mixed) {
    properties.type = { type: 'string' as const, enum: ['movie', 'tv'] }
    required.push('type')
  }

  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      picks: {
        type: 'array' as const,
        items: { type: 'object' as const, additionalProperties: false, properties, required },
      },
    },
    required: ['picks'],
  }
}

interface Pick {
  title: string
  year: number
  reason: string
  // Only present on mixed runs — see buildPicksSchema.
  type?: 'movie' | 'tv'
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

export type RecommendationLength = 'short' | 'medium' | 'long'

// Optional "levers" on generation. All hard-filter the final picks (not just
// prompt hints) — genre/decade come for free off the search results already
// fetched for matching; length needs an extra per-candidate TMDB lookup
// (search doesn't return runtime), so that only happens when a length filter
// is actually set.
export interface RecommendationFilters {
  genre?: string
  // Decade start year, e.g. 1990 for "the 1990s".
  decade?: number
  length?: RecommendationLength
}

function matchesDecade(releaseYear: number | null, decade: number): boolean {
  return releaseYear != null && releaseYear >= decade && releaseYear < decade + 10
}

function matchesLength(runtimeMinutes: number | null, length: RecommendationLength): boolean {
  if (runtimeMinutes == null) return false
  if (length === 'short') return runtimeMinutes < 90
  if (length === 'long') return runtimeMinutes > 150
  return runtimeMinutes >= 90 && runtimeMinutes <= 150
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// Cheap first-pass guard against TMDB search returning something with
// little resemblance to what Claude actually asked for — deliberately
// lenient (normalized edit distance, not exact match) since real TMDB
// titles routinely differ from a natural-language ask in punctuation,
// "the"/no "the", or a translated title. Catches "wrong movie entirely";
// see verifyPicksAgainstOverviews for the case this can't catch — same
// title, same year, different film.
const TITLE_SIMILARITY_THRESHOLD = 0.5

function titlesLikelyMatch(pickTitle: string, foundTitle: string): boolean {
  const a = normalizeTitle(pickTitle)
  const b = normalizeTitle(foundTitle)
  if (!a || !b) return false
  if (a === b) return true

  const distance = levenshteinDistance(a, b)
  const similarity = 1 - distance / Math.max(a.length, b.length)
  return similarity >= TITLE_SIMILARITY_THRESHOLD
}

const VERIFY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    verdicts: { type: 'array' as const, items: { type: 'boolean' as const } },
  },
  required: ['verdicts'],
}

// Second-pass guard: a same-titled, same-year-but-different film would
// sail right through titlesLikelyMatch (and even the year check), since a
// title string can't distinguish two different movies that happen to share
// both. Only the plot itself can — so this asks Claude, which already knows
// what it meant by each pick, to confirm against the actual TMDB overview.
// One batched call for the whole list rather than one per pick.
async function verifyPicksAgainstOverviews<candidate extends { pick: Pick; match: TmdbSearchResult; type: MediaType }>(
  candidates: candidate[],
  mediaType: RunMediaType = 'movie',
): Promise<candidate[]> {
  if (candidates.length === 0) return []

  const noun = MEDIA_NOUNS[mediaType]
  const entryNoun = mediaType === 'tv' ? 'show' : 'entry'

  const items = candidates.map(({ pick, match, type }, index) => ({
    index,
    you_suggested: {
      title: pick.title,
      year: pick.year,
      your_reason: pick.reason,
      ...(mediaType === 'mixed' ? { kind: type === 'tv' ? 'TV show' : 'movie' } : {}),
    },
    tmdb_found: { title: match.title, year: match.releaseYear, overview: match.overview },
  }))

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: VERIFY_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `You previously suggested some ${noun} by title/year. For each one, we looked it up on TMDB and found ` +
          `a specific ${entryNoun} — here's what TMDB returned, described by its own title, year, and plot ` +
          `overview. Confirm whether the TMDB ${entryNoun} found is truly the same one you meant, not just a ` +
          `similarly- or identically-titled different one. Small title differences (translation, punctuation, ` +
          `"the" vs no "the") are fine as long as it's the same ${entryNoun}.\n\n${JSON.stringify(items, null, 2)}\n\n` +
          `Return one boolean per entry, in the same order as given, true only if the TMDB ${entryNoun} found is ` +
          `genuinely the one you meant.`,
      },
    ],
  })

  const { verdicts } = parseStructuredResponse<{ verdicts: boolean[] }>(response)
  return candidates.filter((_, index) => verdicts[index] === true)
}

export interface RecommendationRunSummary {
  id: number
  createdAt: number
  groupLabel: string
  mediaType: RunMediaType
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
  filters: RecommendationFilters = {},
  mediaType: RunMediaType = 'movie',
  // Which taste profile(s) the picks are based on. Independent of what's
  // being generated — "recommend me movies based on my TV taste" is a
  // legitimate ask. Defaults to matching the output type.
  sourceTypes?: MediaType[],
): Promise<GenerateRecommendationsOutcome> {
  const isMixed = mediaType === 'mixed'
  const profileTypes: MediaType[] =
    sourceTypes && sourceTypes.length > 0 ? sourceTypes : isMixed ? ['movie', 'tv'] : [mediaType]

  // Independent per member — regenerate every profile (and fetch their name) concurrently.
  const members = await Promise.all(
    memberUserIds.map(async (memberId) => {
      const [regenerated, user] = await Promise.all([
        Promise.all(profileTypes.map((type) => regenerateTasteProfile(db, memberId, type))),
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
            profileTypes.map((type, i) => [`${MEDIA_NOUNS[type]}_taste`, toTasteSummary(regenerated[i])]),
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

  const picks = await requestPicks(profiles, excludedTitles, filters, mediaType, profileTypes)

  // On a mixed run each pick says whether it's a movie or a show, which
  // decides the TMDB endpoint; on a single-type run they're all that type.
  const pickTypes: MediaType[] = picks.map((pick) => (isMixed ? (pick.type === 'tv' ? 'tv' : 'movie') : mediaType))

  // Independent lookups — resolve every pick against TMDB concurrently, then
  // apply dedup/matching/verification over the results in order.
  const matchesByPick = await Promise.all(picks.map((pick, i) => searchForType(pickTypes[i], pick.title)))

  // Deliberately not capped at TARGET_COUNT here — verifyPicksAgainstOverviews
  // below drops some of these too, so the same over-request slack that
  // covers dedup/filter misses needs to reach verification as well, or a
  // verification drop would under-fill the run instead of just consuming
  // slack that was already budgeted for exactly this.
  const candidates: { pick: Pick; match: TmdbSearchResult; type: MediaType }[] = []
  const seenExternalIds = new Set<string>()

  for (const [i, pick] of picks.entries()) {
    const pickType = pickTypes[i]
    const matches = matchesByPick[i]
    if (matches.length === 0) continue

    const match =
      matches.find((m) => m.releaseYear === pick.year) ??
      [...matches].sort(
        (a, b) => Math.abs((a.releaseYear ?? 0) - pick.year) - Math.abs((b.releaseYear ?? 0) - pick.year),
      )[0]

    // Keyed by type too — TMDB ids are only unique within an endpoint, so
    // a movie and a show can legitimately share one.
    const dedupKey = `${pickType}:${match.externalId}`
    if (excludedExternalIds.has(match.externalId) || seenExternalIds.has(dedupKey)) continue
    if (!titlesLikelyMatch(pick.title, match.title)) continue
    if (filters.genre && !match.tags.includes(filters.genre)) continue
    if (filters.decade != null && !matchesDecade(match.releaseYear, filters.decade)) continue

    // Runtime isn't in search results — only fetched (and only filtered on)
    // when a length lever is actually set, so picks that don't need it never
    // pay for the extra TMDB round trip.
    if (filters.length) {
      const detail = await lookupForType(pickType, match.externalId)
      if (!detail || !matchesLength(detail.runtimeMinutes, filters.length)) continue
    }

    seenExternalIds.add(dedupKey)
    candidates.push({ pick, match, type: pickType })
  }

  // Title similarity can't tell two different films apart when they share
  // both title and year — only content can, so this is a second, semantic
  // pass over the survivors before anything gets written to the catalog.
  const verified = await verifyPicksAgainstOverviews(candidates, mediaType)

  const results: RecommendationResult[] = []
  for (const { pick, match, type } of verified.slice(0, TARGET_COUNT)) {
    const item = await upsertMediaItem(db, type, match)
    results.push({ item, tags: match.tags, reason: pick.reason, status: null })
  }

  const run = await db.create(
    recommendationRuns,
    { user_id: requestingUserId, media_type: mediaType, created_at: Date.now() },
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

  const prunedOldestRun = await pruneOldRuns(db, requestingUserId, mediaType)

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

// Deletes the oldest run(s) for a user beyond MAX_RUNS_PER_USER, scoped to
// one media type — a TV run should never prune an older movie run just
// because the combined total crossed the cap. Returns whether anything was
// deleted. Relies on recommendation_run_members and user_recommendations
// cascading on delete of the run row.
async function pruneOldRuns(db: Db, userId: number, mediaType: RunMediaType): Promise<boolean> {
  const runs = await db.findMany(recommendationRuns, {
    where: { user_id: userId, media_type: mediaType },
    orderBy: ['created_at', 'asc'],
  })
  if (runs.length <= MAX_RUNS_PER_USER) return false

  const excess = runs.slice(0, runs.length - MAX_RUNS_PER_USER)
  await db.deleteMany(recommendationRuns, { where: inList('id', excess.map((run) => run.id)) })
  return true
}

function buildFilterInstructions(filters: RecommendationFilters, noun: string): string {
  const clauses: string[] = []
  if (filters.genre) clauses.push(`Only suggest ${noun} in the "${filters.genre}" genre.`)
  if (filters.decade != null) clauses.push(`Only suggest ${noun} originally released in the ${filters.decade}s.`)
  if (filters.length === 'short') clauses.push(`Only suggest ${noun} with a runtime under 90 minutes.`)
  if (filters.length === 'medium') clauses.push(`Only suggest ${noun} with a runtime between 90 and 150 minutes.`)
  if (filters.length === 'long') clauses.push(`Only suggest ${noun} with a runtime over 150 minutes.`)
  return clauses.length > 0 ? ` ${clauses.join(' ')}` : ''
}

async function requestPicks(
  profiles: MemberProfile[] | MultiSourceMemberProfile[],
  excludedTitles: string[],
  filters: RecommendationFilters = {},
  mediaType: RunMediaType = 'movie',
  sourceTypes: MediaType[] = ['movie'],
): Promise<Pick[]> {
  const isGroup = profiles.length > 1
  const isMixed = mediaType === 'mixed'
  const noun = MEDIA_NOUNS[mediaType]
  // Mixed runs need each pick tagged, and shouldn't quietly collapse into
  // one type — the whole point is a slate spanning both.
  const mixedInstructions = isMixed
    ? ` Return a genuine mix of movies and TV shows rather than leaning entirely on one, and tag every pick ` +
      `with its "type" ("movie" or "tv").`
    : ''
  // Spelled out only when the source profiles aren't simply "the thing
  // being recommended" — otherwise it's noise.
  const sourceNouns = sourceTypes.map((type) => MEDIA_NOUNS[type])
  const sourcesDifferFromOutput = isMixed
    ? sourceTypes.length !== 2
    : sourceTypes.length !== 1 || sourceTypes[0] !== mediaType
  const sourceInstructions = sourcesDifferFromOutput
    ? ` Base these on their ${sourceNouns.join(' and ')} taste profile(s) above — that's deliberate, so carry ` +
      `the sensibility across even though you're recommending ${noun}.`
    : sourceTypes.length > 1
      ? ` Each person has a separate profile per type above; weigh all of them.`
      : ''
  // Hard filters (see generateRecommendations) drop some picks after the
  // fact, so ask for more up front to still land near TARGET_COUNT.
  const hasFilters = filters.genre != null || filters.decade != null || filters.length != null
  const requestedCount = hasFilters ? REQUESTED_COUNT + 10 : REQUESTED_COUNT
  const filterInstructions = buildFilterInstructions(filters, noun) + mixedInstructions + sourceInstructions

  const prompt = isGroup
    ? `Group of ${profiles.length} people, each with their own ${noun} taste profile:\n${JSON.stringify(profiles, null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) this group ` +
      `should watch together.${filterInstructions} Reason explicitly about tradeoffs: avoid picks only one ` +
      `person would like; prefer broad appeal; where genuinely interesting, surface a pick that bridges ` +
      `members' different tastes rather than only the bland common denominator. Do not just average genre ` +
      `tags — reason per-person about how each candidate would land for them specifically. For each pick, give ` +
      `your best-guess release year (used only to disambiguate remakes/same-titled entries) and a reason ` +
      `noting which member(s) it serves and why.`
    : `A person's ${noun} taste profile:\n${JSON.stringify(profiles[0], null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) that match ` +
      `this taste profile.${filterInstructions} For each, give your best-guess release year (used only to ` +
      `disambiguate remakes/same-titled entries) and a one-sentence reason tied to their profile.`

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: (isGroup ? 8000 : 4000) + (hasFilters ? 2000 : 0),
    output_config: {
      effort: isGroup ? 'high' : 'medium',
      format: { type: 'json_schema', schema: buildPicksSchema(isMixed) },
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
      mediaType: run.media_type,
    })),
  )
}

// Group runs someone else requested that included this user as a member —
// e.g. a friend generated picks "for" a group they added this user to.
// Restricted to mutual follows (same bar as notifyMutualFollowers): being
// added to someone's run isn't itself consent to show up on their page, so
// this only surfaces if the requester also follows this user back.
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
    return { id: run.id, createdAt: run.created_at, groupLabel, mediaType: run.media_type, otherMemberLabels, results: [] }
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

  return { id: run.id, createdAt: run.created_at, groupLabel, mediaType: run.media_type, otherMemberLabels, results }
}
