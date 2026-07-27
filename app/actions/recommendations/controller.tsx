import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { listFollowedUsers } from '../../data/follows.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { generateRecommendations, getRecommendationRun, listRecommendationRuns } from '../../data/recommendations.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { RecommendationsPage } from './page.tsx'
import { RecommendationRunPage } from './run-page.tsx'

const generateSchema = f.object({
  mode: f.field(s.union([s.literal('self'), s.literal('group')])),
})

export default createController(routes.recommendations, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const runs = await listRecommendationRuns(db, auth.identity.id)
      const friends = await listFollowedUsers(db, auth.identity.id)

      return context.render(
        <RecommendationsPage runs={runs} friends={friends} displayName={displayLabel(auth.identity)} />,
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

      const db = context.get(Database)
      const { runId, prunedOldestRun } = await generateRecommendations(db, auth.identity.id, [
        auth.identity.id,
        ...friendIds,
      ])

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
