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
  length: f.field(s.defaulted(s.string(), '')),
  name: f.field(s.defaulted(s.string(), '')),
})

// From plain (db, user) rather than a request context, so the generate action
// can re-render this page when it rejects a run.
async function loadIndexData(db: Db, user: User, mediaType: ActiveMediaType) {
  const [allRuns, allRunsFromOthers, friends] = await Promise.all([
    listRecommendationRuns(db, user.id),
    listRecommendationRunsFromOthers(db, user.id),
    listFollowedUsers(db, user.id),
  ])

  return {
    // Matched to the current tab, or a TV run lists under a movie form.
    runs: allRuns.filter((run) => run.mediaType === mediaType),
    runsFromOthers: allRunsFromOthers.filter((run) => run.mediaType === mediaType),
    friends,
    genres: getCatalogProvider(mediaType).genres,
    lengthOptions: getCatalogProvider(mediaType).lengthOptions,
    displayName: displayLabel(user),
  }
}

export default createController(routes.recommendations, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      // An explicit ?mediaType= wins; otherwise the type last remembered from
      // Media, so arriving via the nav link stays put instead of resetting to
      // movies. Remembered either way, so Media picks up a choice made here.
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
          mediaType={mediaType}
          genres={data.genres}
          lengthOptions={data.lengthOptions}
          displayName={data.displayName}
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
      if (parsed.value.length === 'short' || parsed.value.length === 'medium' || parsed.value.length === 'long') {
        filters.length = parsed.value.length
      }

      // Defaults to matching what's being generated.
      const sourceTypes = formData
        .getAll('source')
        .map((value) => String(value))
        .map((value) => parseEnabledMediaType(value))
        .filter((value): value is ActiveMediaType => value !== null)

      const db = context.get(Database)
      const memberIds = [auth.identity.id, ...friendIds]
      // MediaType widens to string through the row types; narrow once here.
      const mediaType = parseEnabledMediaType(parsed.value.mediaType) ?? DEFAULT_MEDIA_TYPE
      // Mirrors generateRecommendations' own default, so the guard below checks
      // the profiles the run would actually use.
      const profileTypes = sourceTypes.length > 0 ? sourceTypes : [mediaType]

      // An empty log yields an empty profile, silently ignoring that person.
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
            mediaType={mediaType}
            genres={data.genres}
          lengthOptions={data.lengthOptions}
            displayName={data.displayName}
            error={`Can't generate this run — ${detail}. Everyone included needs something logged for each taste you're basing picks on.`}
          />,
          { status: 400 },
        )
      }

      // Same levers as a run they haven't acted on — ask before spending a
      // model call on a second unfinished list. `force` gets past this.
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
              mediaType={mediaType}
              genres={data.genres}
              lengthOptions={data.lengthOptions}
              displayName={data.displayName}
              duplicate={{
                runId: duplicate.runId,
                name: duplicate.name,
                createdAt: duplicate.createdAt,
                // So "generate anyway" doesn't depend on the form still
                // being filled in.
                fields: [
                  ['mediaType', mediaType],
                  ['mode', parsed.value.mode],
                  ['name', parsed.value.name ?? ''],
                  ['genre', filters.genre ?? ''],
                  ['decade', filters.decade == null ? '' : String(filters.decade)],
                  ['length', filters.length ?? ''],
                  ...sourceTypes.map((type) => ['source', type] as [string, string]),
                  ...friendIds.map((id) => ['friend_ids', String(id)] as [string, string]),
                ],
              }}
            />,
          )
        }
      }

      // Queued, not started: generation is long and fans out into rate-limited
      // services, so a fixed-slot worker runs it. See recommendations/worker.ts.
      if (await hasActiveJob(db, auth.identity.id)) {
        const data = await loadIndexData(db, auth.identity, mediaType)
        return context.render(
          <RecommendationsPage
            runs={data.runs}
            runsFromOthers={data.runsFromOthers}
            friends={data.friends}
            mediaType={mediaType}
            genres={data.genres}
            lengthOptions={data.lengthOptions}
            displayName={data.displayName}
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

    // Server-rendered with the current stage, so it says something true before
    // any polling — and keeps working without JS via its meta refresh.
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

    // JSON rather than HTML — the client entry swaps a caption, not a page.
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
