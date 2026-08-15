import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { Session } from 'remix/session'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { getCatalogProvider } from '../../data/catalog/provider.ts'
import type { Db } from '../../data/db.ts'
import { listFollowedUsers } from '../../data/follows.ts'
import { loadLoggedTypesByUser } from '../../data/mediaItems.ts'
import { getDailyRunAllowance, runCostFor, timeUntil } from '../../data/recommendations/dailyLimit.ts'
import { enqueueJob, getJob, hasActiveJob, PHASE_LABELS } from '../../data/recommendations/jobs.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { getRememberedMediaType } from '../../middleware/mediaType.ts'
import { findMembersMissingSourceLogs, generateRecommendations } from '../../data/recommendations/generate.ts'
import type { RecommendationFilters } from '../../data/recommendations/picks.ts'
import {
  findUnusedDuplicateRun,
  getRecommendationRun,
  listRecommendationRuns,
  listRecommendationRunsFromOthers,
} from '../../data/recommendations/runs.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import {
  DEFAULT_MEDIA_TYPE,
  mediaTypeUiFor,
  parseEnabledMediaType,
  type ActiveMediaType,
} from '../../mediaTypes.ts'
import { GeneratingPage } from './generating-page.tsx'
import { RecommendationsPage } from './page.tsx'
import { RecommendationRunPage } from './run-page.tsx'

const generateSchema = f.object({
  mode: f.field(s.union([s.literal('self'), s.literal('group')])),
  // Validated against the registry below rather than a literal union here: a
  // union would reject any newly-wired-up type until someone edited this
  // schema, and TypeScript can't flag the omission in a runtime schema.
  mediaType: f.field(s.defaulted(s.string(), 'movie')),
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
  const [runs, runsFromOthers, friends, dailyRuns] = await Promise.all([
    listRecommendationRuns(db, user.id, mediaType),
    listRecommendationRunsFromOthers(db, user.id, mediaType),
    listFollowedUsers(db, user.id),
    getDailyRunAllowance(db, user),
  ])

  // After the fetch above rather than alongside it, since it needs the ids it
  // returns. One query for everyone the picker can offer, so the form can grey
  // out a run before it's requested rather than after it's refused.
  const loggedByUser = await loadLoggedTypesByUser([user.id, ...friends.map((friend) => friend.id)])

  return {
    dailyRuns,
    runs,
    runsFromOthers,
    friends,
    loggedTypes: Object.fromEntries(
      friends.map((friend) => [friend.id, [...(loggedByUser.get(friend.id) ?? [])]]),
    ),
    viewerLoggedTypes: [...(loggedByUser.get(user.id) ?? [])],
    genres: getCatalogProvider(mediaType).genres,
    lengthOptions: getCatalogProvider(mediaType).lengthOptions.map(({ value, label }) => ({ value, label })),
    playerTypes: getCatalogProvider(mediaType).playerTypes ?? [],
    multiplayerTypes: getCatalogProvider(mediaType).multiplayerTypes ?? [],
    platforms: getCatalogProvider(mediaType).platforms ?? [],
    seriesTypes: getCatalogProvider(mediaType).seriesTypes ?? [],
    displayName: displayLabel(user),
  }
}

export default createController(routes.recommendations, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaType =
        parseEnabledMediaType(context.url.searchParams.get('mediaType')) ?? getRememberedMediaType(context)
      context.get(Session).set('mediaType', mediaType)

      const db = context.get(Database)
      const data = await loadIndexData(db, auth.identity, mediaType)

      return context.render(
        <RecommendationsPage
          runs={data.runs}
          runsFromOthers={data.runsFromOthers}
          friends={data.friends}
            loggedTypes={data.loggedTypes}
            viewerLoggedTypes={data.viewerLoggedTypes}
          mediaType={mediaType}
          genres={data.genres}
          lengthOptions={data.lengthOptions}
          playerTypes={data.playerTypes}
          multiplayerTypes={data.multiplayerTypes}
          platforms={data.platforms}
          seriesTypes={data.seriesTypes}
          displayName={data.displayName}
          dailyRuns={data.dailyRuns}
        />,
      )
    },

    async generate(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

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
        .map((value) => parseEnabledMediaType(value))
        .filter((value): value is ActiveMediaType => value !== null)

      const db = context.get(Database)
      const memberIds = [auth.identity.id, ...friendIds]
      const mediaType = parseEnabledMediaType(parsed.value.mediaType) ?? DEFAULT_MEDIA_TYPE
      const profileTypes = sourceTypes.length > 0 ? sourceTypes : [mediaType]

      const missing = await findMembersMissingSourceLogs(db, memberIds, profileTypes)
      if (missing.length > 0) {
        const detail = missing
          .map(({ userId, label, missing: types }) => {
            const nouns = types.map((type) => mediaTypeUiFor(type).plural).join(' or ')
            return userId === auth.identity.id
              ? `you have no ${nouns} logged`
              : `${label} has no ${nouns} logged`
          })
          .join(', and ')
        const data = await loadIndexData(db, auth.identity, mediaType)

        return context.render(
          <RecommendationsPage
            runs={data.runs}
            runsFromOthers={data.runsFromOthers}
            friends={data.friends}
            loggedTypes={data.loggedTypes}
            viewerLoggedTypes={data.viewerLoggedTypes}
            mediaType={mediaType}
            genres={data.genres}
            lengthOptions={data.lengthOptions}
            playerTypes={data.playerTypes}
            multiplayerTypes={data.multiplayerTypes}
            platforms={data.platforms}
            seriesTypes={data.seriesTypes}
            displayName={data.displayName}
            dailyRuns={data.dailyRuns}
            error={`Can't generate this run — ${detail}. Everyone included needs something logged for each taste you're basing picks on.`}
          />,
          { status: 400 },
        )
      }

      const allowance = await getDailyRunAllowance(db, auth.identity)
      const runCost = runCostFor(memberIds.length)
      if (!allowance.unlimited && allowance.remaining < runCost) {
        const data = await loadIndexData(db, auth.identity, mediaType)
        const wait =
          allowance.resetsAt == null
            ? ''
            : ` The next one frees up in about ${timeUntil(allowance.resetsAt)}.`

        return context.render(
          <RecommendationsPage
            runs={data.runs}
            runsFromOthers={data.runsFromOthers}
            friends={data.friends}
            loggedTypes={data.loggedTypes}
            viewerLoggedTypes={data.viewerLoggedTypes}
            mediaType={mediaType}
            genres={data.genres}
            lengthOptions={data.lengthOptions}
            playerTypes={data.playerTypes}
            multiplayerTypes={data.multiplayerTypes}
            platforms={data.platforms}
            seriesTypes={data.seriesTypes}
            displayName={data.displayName}
            dailyRuns={data.dailyRuns}
            error={
              allowance.remaining === 0
                ? `You've used all ${allowance.limit} of your recommendation runs for today.${wait}`
                : `A run for ${memberIds.length} people costs ${runCost} of your ${allowance.limit} daily runs, ` +
                  `and you have ${allowance.remaining} left. Try again with fewer people, or later.${wait}`
            }
          />,
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
          const data = await loadIndexData(db, auth.identity, mediaType)
          return context.render(
            <RecommendationsPage
              runs={data.runs}
              runsFromOthers={data.runsFromOthers}
              friends={data.friends}
            loggedTypes={data.loggedTypes}
            viewerLoggedTypes={data.viewerLoggedTypes}
              mediaType={mediaType}
              genres={data.genres}
              lengthOptions={data.lengthOptions}
              playerTypes={data.playerTypes}
              multiplayerTypes={data.multiplayerTypes}
              platforms={data.platforms}
              seriesTypes={data.seriesTypes}
              displayName={data.displayName}
              dailyRuns={data.dailyRuns}
              duplicate={{
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
              }}
            />,
          )
        }
      }

      if (await hasActiveJob(db, auth.identity.id)) {
        const data = await loadIndexData(db, auth.identity, mediaType)
        return context.render(
          <RecommendationsPage
            runs={data.runs}
            runsFromOthers={data.runsFromOthers}
            friends={data.friends}
            loggedTypes={data.loggedTypes}
            viewerLoggedTypes={data.viewerLoggedTypes}
            mediaType={mediaType}
            genres={data.genres}
            lengthOptions={data.lengthOptions}
            playerTypes={data.playerTypes}
            multiplayerTypes={data.multiplayerTypes}
            platforms={data.platforms}
            seriesTypes={data.seriesTypes}
            displayName={data.displayName}
            dailyRuns={data.dailyRuns}
            error="You already have a run in progress — give that one a moment to finish first."
          />,
          { status: 409 },
        )
      }

      const jobId = await enqueueJob(
        db,
        auth.identity.id,
        {
          memberIds,
          mediaType,
          filters: filters as Record<string, unknown>,
          sourceTypes,
          name: parsed.value.name || undefined,
        },
        { withLengthCheck: filters.length != null },
      )

      return redirect(routes.recommendations.generating.href({ jobId }), 303)
    },

    async generating(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const job = await getJob(context.get(Database), context.params.jobId, auth.identity.id)
      if (!job) return new Response('Not Found', { status: 404 })

      if (job.runId != null) {
        const href = routes.recommendations.show.href({ runId: String(job.runId) })
        return redirect(job.prunedOldestRun ? `${href}?prunedOldest=1` : href, 303)
      }

      return context.render(
        <GeneratingPage
          jobId={context.params.jobId}
          phase={job.phase}
          phases={job.phases}
          status={job.status}
          queuedAhead={job.queuedAhead ?? null}
          error={job.error}
          statusHref={routes.recommendations.status.href({ jobId: context.params.jobId })}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async status(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const job = await getJob(context.get(Database), context.params.jobId, auth.identity.id)
      if (!job) return Response.json({ error: 'not_found' }, { status: 404 })

      return Response.json({
        status: job.status,
        queuedAhead: job.queuedAhead ?? null,
        phase: job.phase,
        label: PHASE_LABELS[job.phase],
        done: job.runId != null,
        href:
          job.runId == null
            ? null
            : routes.recommendations.show.href({ runId: String(job.runId) }) +
              (job.prunedOldestRun ? '?prunedOldest=1' : ''),
        error: job.error ?? null,
      })
    },

    async show(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const run = await getRecommendationRun(db, Number(context.params.runId), auth.identity.id)
      if (!run) return new Response('Not Found', { status: 404 })

      return context.render(
        <RecommendationRunPage
          run={run}
          displayName={displayLabel(auth.identity)}
          prunedOldestRun={context.url.searchParams.get('prunedOldest') === '1'}
        />,
      )
    },
  },
})
