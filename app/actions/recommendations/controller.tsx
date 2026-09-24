import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { getCatalogProvider } from '../../data/catalog/provider.ts'
import type { Db } from '../../data/db.ts'
import { listFollowedUsers } from '../../data/follows.ts'
import { syncLetterboxdBeforeRun } from '../../data/imports/letterboxdSync.ts'
import { loadLoggedTypesByUser } from '../../data/mediaItems.ts'
import { getDailyRunAllowance, runCostFor, timeUntil } from '../../data/recommendations/dailyLimit.ts'
import { enqueueJob, getJob, PHASE_LABELS, type GenerationJob } from '../../data/recommendations/jobs.ts'
import { getLuckyState, LUCKY_RUN_NAME } from '../../data/recommendations/lucky.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import {
  findMembersMissingSourceLogs,
  generateRecommendations,
  type MissingSourceLogs,
} from '../../data/recommendations/generate.ts'
import type { RecommendationFilters } from '../../data/recommendations/picks.ts'
import {
  findUnusedDuplicateRun,
  getRecommendationRun,
  listRecommendationRuns,
  listRecommendationRunsFromOthers,
} from '../../data/recommendations/runs.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { DEFAULT_MEDIA_TYPE, mediaTypeUiFor, parseMediaType, type ActiveMediaType } from '../../mediaTypes.ts'
import { RETURN_TO_PARAM } from '../../ui/backLink.ts'
import { LUCKY_PAGE_ORIGIN } from '../../browser/draw-lucky-form.tsx'
import { GeneratingPage } from './generating-page.tsx'
import { getUnconfirmedRun, listUnconfirmedRuns } from '../../data/recommendations/unconfirmed.ts'
import { UnconfirmedRunPage } from './unconfirmed-page.tsx'
import { LuckyPickPage, type LuckyPickPageProps } from './lucky-page.tsx'
import { RecommendationsPage, type RecommendationsPageProps } from './page.tsx'
import { RecommendationRunPage } from './run-page.tsx'

const generateSchema = f.object({
  mode: f.field(s.union([s.literal('self'), s.literal('group')])),
  // Validated against the registry below rather than a literal union here: a
  // union would reject any newly-wired-up type until someone edited this
  // schema, and TypeScript can't flag the omission in a runtime schema.
  mediaType: f.field(s.defaulted(s.string(), DEFAULT_MEDIA_TYPE)),
  genre: f.field(s.defaulted(s.string(), '')),
  decade: f.field(s.defaulted(s.string(), '')),
  decade_relation: f.field(s.defaulted(s.string(), '')),
  length: f.field(s.defaulted(s.string(), '')),
  player_type: f.field(s.defaulted(s.string(), '')),
  multiplayer_type: f.field(s.defaulted(s.string(), '')),
  platform: f.field(s.defaulted(s.string(), '')),
  series: f.field(s.defaulted(s.string(), '')),
  name: f.field(s.defaulted(s.string(), '')),
})

async function loadIndexData(db: Db, user: User, mediaType: ActiveMediaType) {
  const [allRuns, runsFromOthers, friends, dailyRuns, lucky, unconfirmedRuns] = await Promise.all([
    listRecommendationRuns(db, user.id, mediaType),
    listRecommendationRunsFromOthers(db, user.id, mediaType),
    listFollowedUsers(db, user.id),
    getDailyRunAllowance(db, user),
    getLuckyState(user),
    // Not filtered by media type, unlike the runs above: there are at most three,
    // and a list this small hiding two thirds of itself behind a tab is a way to
    // lose them.
    listUnconfirmedRuns(db, user.id),
  ])

  // The page shows these as separate sections rather than one list.
  const runs = allRuns.filter((run) => !run.isLucky)
  const luckyRuns = allRuns.filter((run) => run.isLucky)

  // After the fetch above rather than alongside it, since it needs the ids it
  // returns. One query for everyone the picker can offer, so the form can grey
  // out a run before it's requested rather than after it's refused.
  const loggedByUser = await loadLoggedTypesByUser([user.id, ...friends.map((friend) => friend.id)])

  const provider = getCatalogProvider(mediaType)

  return {
    dailyRuns,
    lucky,
    runs,
    unconfirmedRuns,
    luckyRuns,
    runsFromOthers,
    friends,
    loggedTypes: Object.fromEntries(
      friends.map((friend) => [friend.id, [...(loggedByUser.get(friend.id) ?? [])]]),
    ),
    viewerLoggedTypes: [...(loggedByUser.get(user.id) ?? [])],
    genres: provider.genres,
    lengthOptions: provider.lengthOptions.map(({ value, label }) => ({ value, label })),
    playerTypes: provider.playerTypes ?? [],
    multiplayerTypes: provider.multiplayerTypes ?? [],
    platforms: provider.platforms ?? [],
    seriesTypes: provider.seriesTypes ?? [],
    displayName: displayLabel(user),
  }
}

// Both actions refuse for the same reason in the same words — an empty log
// gives the profile nothing to work from, whichever kind of run asked for it.
// Where a finished job sends someone: a real run, or the unconfirmed picks kept
// when the catalog wouldn't answer. Spelled once, because the redirect and the poll
// the generating page runs both need it and must not be able to disagree.
function finishedHref(job: GenerationJob): string | null {
  if (job.runId != null) {
    const href = routes.recommendations.show.href({ runId: String(job.runId) })
    return job.prunedOldestRun ? `${href}?prunedOldest=1` : href
  }
  if (job.unconfirmedRunId != null) {
    return routes.recommendations.unconfirmed.href({ unconfirmedId: String(job.unconfirmedRunId) })
  }
  return null
}

function describeMissingLogs(missing: MissingSourceLogs[], viewerId: number): string {
  return missing
    .map(({ userId, label, missing: types }) => {
      const nouns = types.map((type) => mediaTypeUiFor(type).plural).join(' or ')
      return userId === viewerId ? `you have no ${nouns} logged` : `${label} has no ${nouns} logged`
    })
    .join(', and ')
}

// Every path through `generate` that doesn't redirect re-renders the index with
// something to say. Building the element in one place is what keeps a prop added
// to the page from reaching every call site.
async function indexPage(
  db: Db,
  user: User,
  mediaType: ActiveMediaType,
  extras: Pick<RecommendationsPageProps, 'error' | 'duplicate'> = {},
) {
  const data = await loadIndexData(db, user, mediaType)
  return <RecommendationsPage {...data} mediaType={mediaType} {...extras} />
}

async function loadLuckyPageData(db: Db, user: User, mediaType: ActiveMediaType) {
  const [friends, lucky] = await Promise.all([listFollowedUsers(db, user.id), getLuckyState(user)])

  const loggedByUser = await loadLoggedTypesByUser([user.id, ...friends.map((friend) => friend.id)])

  return {
    lucky,
    friends: friends.map((friend) => ({
      id: friend.id,
      label: displayLabel(friend),
      loggedTypes: [...(loggedByUser.get(friend.id) ?? [])],
    })),
    viewerLoggedTypes: [...(loggedByUser.get(user.id) ?? [])],
    displayName: displayLabel(user),
  }
}

// The lucky page's counterpart to indexPage above.
async function luckyDrawPage(
  db: Db,
  user: User,
  mediaType: ActiveMediaType,
  extras: Pick<LuckyPickPageProps, 'error'> = {},
) {
  const data = await loadLuckyPageData(db, user, mediaType)
  return (
    <LuckyPickPage {...data} mediaType={mediaType} findPeopleHref={routes.users.search.href()} {...extras} />
  )
}

export default createController(routes.recommendations, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)

      const mediaType = parseMediaType(context.url.searchParams.get('mediaType')) ?? DEFAULT_MEDIA_TYPE

      const db = context.get(Database)

      return context.render(await indexPage(db, auth.identity, mediaType))
    },

    async luckyPage(context) {
      const auth = context.get(Auth)

      const mediaType = parseMediaType(context.url.searchParams.get('mediaType')) ?? DEFAULT_MEDIA_TYPE

      const db = context.get(Database)

      return context.render(await luckyDrawPage(db, auth.identity, mediaType))
    },

    async generate(context) {
      const auth = context.get(Auth)

      const formData = context.get(FormData)
      const parsed = s.parseSafe(generateSchema, formData)
      if (!parsed.success) {
        return new Response('Invalid request', { status: 400 })
      }

      const friendIds =
        parsed.value.mode === 'group'
          ? formData
              .getAll('friend_ids')
              .map((value) => Number(value))
              .filter((id) => Number.isInteger(id))
          : []

      const filters: RecommendationFilters = {}
      if (parsed.value.genre) filters.genre = parsed.value.genre
      if (parsed.value.decade) filters.decade = Number(parsed.value.decade)
      if (
        parsed.value.decade_relation === 'before' ||
        parsed.value.decade_relation === 'within' ||
        parsed.value.decade_relation === 'after'
      ) {
        filters.decadeRelation = parsed.value.decade_relation
      }
      if (
        parsed.value.length === 'short' ||
        parsed.value.length === 'medium' ||
        parsed.value.length === 'long' ||
        parsed.value.length === 'very_long'
      ) {
        filters.length = parsed.value.length
      }
      if (parsed.value.player_type) filters.playerType = parsed.value.player_type
      if (parsed.value.multiplayer_type) filters.multiplayerType = parsed.value.multiplayer_type
      if (parsed.value.platform) filters.platform = parsed.value.platform
      if (parsed.value.series) filters.series = parsed.value.series

      const sourceTypes = formData
        .getAll('source')
        .map((value) => String(value))
        .map((value) => parseMediaType(value))
        .filter((value): value is ActiveMediaType => value !== null)

      const db = context.get(Database)

      // Ahead of everything that reads the log, including the gate below: a run
      // built on a week-stale diary recommends films already watched, and
      // someone whose movies live entirely on Letterboxd would otherwise be
      // turned away for having nothing logged. Bounded, so a slow feed delays
      // the run rather than failing it — and it is a no-op for the vast
      // majority of runs, which are inside the fetch cooldown.
      await syncLetterboxdBeforeRun(db, auth.identity)

      const memberIds = [auth.identity.id, ...friendIds]
      const mediaType = parseMediaType(parsed.value.mediaType) ?? DEFAULT_MEDIA_TYPE
      const profileTypes = sourceTypes.length > 0 ? sourceTypes : [mediaType]

      const missing = await findMembersMissingSourceLogs(db, memberIds, profileTypes)
      if (missing.length > 0) {
        const detail = describeMissingLogs(missing, auth.identity.id)
        return context.render(
          await indexPage(db, auth.identity, mediaType, {
            error:
              `Can't generate this run — ${detail}. Everyone included needs something ` +
              `logged for each taste you're basing picks on.`,
          }),
          { status: 400 },
        )
      }

      const allowance = await getDailyRunAllowance(db, auth.identity)
      const runCost = runCostFor(memberIds.length)
      if (!allowance.unlimited && allowance.remaining < runCost) {
        const wait =
          allowance.resetsAt == null
            ? ''
            : ` The next one frees up in about ${timeUntil(allowance.resetsAt)}.`

        return context.render(
          await indexPage(db, auth.identity, mediaType, {
            error:
              allowance.remaining === 0
                ? `You've used all ${allowance.limit} of your recommendation runs for today.${wait}`
                : `A run for ${memberIds.length} people costs ${runCost} of your ${allowance.limit} daily runs, ` +
                  `and you have ${allowance.remaining} left. Try again with fewer people, or later.${wait}`,
          }),
          { status: 429 },
        )
      }

      if (!formData.get('force')) {
        const duplicate = await findUnusedDuplicateRun(
          db,
          auth.identity.id,
          memberIds,
          mediaType,
          filters,
          sourceTypes,
        )

        if (duplicate) {
          return context.render(
            await indexPage(db, auth.identity, mediaType, {
              duplicate: {
                runId: duplicate.runId,
                name: duplicate.name,
                createdAt: duplicate.createdAt,
                fields: [
                  ['mediaType', mediaType],
                  ['mode', parsed.value.mode],
                  ['name', parsed.value.name ?? ''],
                  ['genre', filters.genre ?? ''],
                  ['decade', filters.decade == null ? '' : String(filters.decade)],
                  ['decade_relation', filters.decadeRelation ?? ''],
                  ['length', filters.length ?? ''],
                  ['player_type', filters.playerType ?? ''],
                  ['multiplayer_type', filters.multiplayerType ?? ''],
                  ['platform', filters.platform ?? ''],
                  ['series', filters.series ?? ''],
                  ...sourceTypes.map((type) => ['source', type] as [string, string]),
                  ...friendIds.map((id) => ['friend_ids', String(id)] as [string, string]),
                ],
              },
            }),
          )
        }
      }

      // No pre-check: the insert refuses a second active run for this user, so
      // two requests arriving together can't both get through.
      const enqueued = await enqueueJob(db, auth.identity.id, {
        memberIds,
        mediaType,
        filters: filters as Record<string, unknown>,
        sourceTypes,
        name: parsed.value.name || undefined,
      })

      if (!enqueued.ok) {
        return context.render(
          await indexPage(db, auth.identity, mediaType, {
            error: 'You already have a run in progress — give that one a moment to finish first.',
          }),
          { status: 409 },
        )
      }

      return redirect(routes.recommendations.generating.href({ jobId: enqueued.jobId }), 303)
    },

    // One pick, no levers, once a day: nothing to read but the medium and
    // who's in the draw. Reachable from the general form's radio and from the
    // dedicated draw page, so `origin` says which one a failure bounces back to.
    async lucky(context) {
      const auth = context.get(Auth)

      const db = context.get(Database)
      const formData = context.get(FormData)
      const fromLuckyPage = formData.get('origin') === LUCKY_PAGE_ORIGIN
      const renderFailure = (mediaType: ActiveMediaType, error: string) =>
        fromLuckyPage
          ? luckyDrawPage(db, auth.identity, mediaType, { error })
          : indexPage(db, auth.identity, mediaType, { error })

      const mediaType = parseMediaType(formData.get('mediaType')) ?? DEFAULT_MEDIA_TYPE

      // `mode` decides whether the checkboxes count at all, the same way it does
      // in `generate`: the shared form keeps every friend checkbox mounted and
      // only hides them, so a selection made and then switched away from is
      // still in the request.
      //
      // What survives that is narrowed to people this account actually follows.
      // The picker only offers those, so it costs nothing in the normal case —
      // it stops a hand-posted id pulling a stranger's taste into a run and
      // notifying them about it.
      const requested = new Set(
        formData.get('mode') === 'group'
          ? formData
              .getAll('friend_ids')
              .map((value) => Number(value))
              .filter((id) => Number.isInteger(id))
          : [],
      )
      const friendIds =
        requested.size === 0
          ? []
          : (await listFollowedUsers(db, auth.identity.id))
              .map((friend) => friend.id)
              .filter((id) => requested.has(id))

      const memberIds = [auth.identity.id, ...friendIds]

      const lucky = await getLuckyState(auth.identity)
      if (!lucky.available) {
        return context.render(
          await renderFailure(
            mediaType,
            lucky.nextAt == null
              ? `You've already drawn today's lucky pick.`
              : `You've already drawn today's lucky pick — the next one frees up in about ${timeUntil(lucky.nextAt)}.`,
          ),
          { status: 429 },
        )
      }

      // A lucky run reads one taste: the medium it is drawing from. Same check
      // `generate` makes, because the same emptiness would silently drop someone
      // from the run.
      const missing = await findMembersMissingSourceLogs(db, memberIds, [mediaType])
      if (missing.length > 0) {
        const detail = describeMissingLogs(missing, auth.identity.id)
        return context.render(
          await renderFailure(
            mediaType,
            `Can't draw a lucky pick — ${detail}. Everyone in the draw needs something logged.`,
          ),
          { status: 400 },
        )
      }

      // No duplicate check: a lucky run carries no levers to match on, and its
      // once-a-day cap already rules out drawing the same thing twice in a day.
      const enqueued = await enqueueJob(db, auth.identity.id, {
        memberIds,
        mediaType,
        filters: {},
        sourceTypes: [mediaType],
        name: LUCKY_RUN_NAME,
        lucky: true,
      })

      if (!enqueued.ok) {
        return context.render(
          await renderFailure(
            mediaType,
            'You already have a run in progress — give that one a moment to finish first.',
          ),
          { status: 409 },
        )
      }

      return redirect(routes.recommendations.generating.href({ jobId: enqueued.jobId }), 303)
    },

    async generating(context) {
      const auth = context.get(Auth)

      const job = await getJob(context.get(Database), context.params.jobId, auth.identity.id)
      if (!job) return new Response('Not Found', { status: 404 })

      const finished = finishedHref(job)
      if (finished) return redirect(finished, 303)

      return context.render(
        <GeneratingPage
          jobId={context.params.jobId}
          phase={job.phase}
          phases={job.phases}
          status={job.status}
          queuedAhead={job.queuedAhead ?? null}
          error={job.error}
          statusHref={routes.recommendations.status.href({ jobId: context.params.jobId })}
          formHref={routes.recommendations.index.href()}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async status(context) {
      const auth = context.get(Auth)

      const job = await getJob(context.get(Database), context.params.jobId, auth.identity.id)
      if (!job) return Response.json({ error: 'not_found' }, { status: 404 })

      return Response.json({
        status: job.status,
        queuedAhead: job.queuedAhead ?? null,
        phase: job.phase,
        label: PHASE_LABELS[job.phase],
        done: finishedHref(job) != null,
        href: finishedHref(job),
        error: job.error ?? null,
      })
    },

    async unconfirmed(context) {
      const auth = context.get(Auth)

      const run = await getUnconfirmedRun(
        context.get(Database),
        Number(context.params.unconfirmedId),
        auth.identity.id,
      )
      if (!run) return new Response('Not Found', { status: 404 })

      return context.render(<UnconfirmedRunPage run={run} displayName={displayLabel(auth.identity)} />)
    },

    async show(context) {
      const auth = context.get(Auth)

      const db = context.get(Database)
      const run = await getRecommendationRun(db, Number(context.params.runId), auth.identity.id)
      if (!run) return new Response('Not Found', { status: 404 })

      return context.render(
        <RecommendationRunPage
          run={run}
          displayName={displayLabel(auth.identity)}
          prunedOldestRun={context.url.searchParams.get('prunedOldest') === '1'}
          from={context.url.searchParams.get(RETURN_TO_PARAM) || undefined}
        />,
      )
    },
  },
})
