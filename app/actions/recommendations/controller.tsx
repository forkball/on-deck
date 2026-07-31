import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { Session } from 'remix/session'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { listFollowedUsers } from '../../data/follows.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { getRememberedMediaType } from '../../middleware/mediaType.ts'
import {
  generateRecommendations,
  getRecommendationRun,
  listRecommendationRuns,
  listRecommendationRunsFromOthers,
  type RecommendationFilters,
} from '../../data/recommendations.ts'
import { MOVIE_GENRES, TV_GENRES } from '../../data/tmdb.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { RecommendationsPage } from './page.tsx'
import { RecommendationRunPage } from './run-page.tsx'

const generateSchema = f.object({
  mode: f.field(s.union([s.literal('self'), s.literal('group')])),
  mediaType: f.field(s.defaulted(s.union([s.literal('movie'), s.literal('tv')]), 'movie')),
  genre: f.field(s.defaulted(s.string(), '')),
  decade: f.field(s.defaulted(s.string(), '')),
  length: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.recommendations, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      // Which media type this page is for: an explicit ?mediaType= (set by
      // the FAB, a plain navigation link) wins; otherwise fall back to
      // whichever type was last remembered from visiting Media, so landing
      // here via the nav link (no query string) stays on the same type
      // instead of always defaulting back to movies. Either way, remember
      // it — so if you *did* pick a type here, the Media link picks it back
      // up too. Server-rendered, not client state, so the right genre list
      // just comes out right without needing JS to swap it.
      const explicitMediaType = context.url.searchParams.get('mediaType')
      const mediaType =
        explicitMediaType === 'tv' || explicitMediaType === 'movie' ? explicitMediaType : getRememberedMediaType(context)
      context.get(Session).set('mediaType', mediaType)

      const db = context.get(Database)
      const allRuns = await listRecommendationRuns(db, auth.identity.id)
      const allRunsFromOthers = await listRecommendationRunsFromOthers(db, auth.identity.id)
      const friends = await listFollowedUsers(db, auth.identity.id)

      // Filtered to match the FAB's current type — otherwise a TV run would
      // show up in the list while the form above it is set to generate
      // movies, which reads as inconsistent.
      const runs = allRuns.filter((run) => run.mediaType === mediaType)
      const runsFromOthers = allRunsFromOthers.filter((run) => run.mediaType === mediaType)

      return context.render(
        <RecommendationsPage
          runs={runs}
          runsFromOthers={runsFromOthers}
          friends={friends}
          mediaType={mediaType}
          genres={mediaType === 'tv' ? TV_GENRES : MOVIE_GENRES}
          displayName={displayLabel(auth.identity)}
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

      // Which taste profiles to base picks on. Defaults to matching what's
      // being generated, so the common case needs no thought.
      const sourceTypes = formData
        .getAll('source')
        .map((value) => String(value))
        .filter((value): value is 'movie' | 'tv' => value === 'movie' || value === 'tv')

      const db = context.get(Database)
      const { runId, prunedOldestRun } = await generateRecommendations(
        db,
        auth.identity.id,
        [auth.identity.id, ...friendIds],
        filters,
        parsed.value.mediaType,
        sourceTypes,
      )

      const href = routes.recommendations.show.href({ runId: String(runId) })
      return redirect(prunedOldestRun ? `${href}?prunedOldest=1` : href, 303)
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
