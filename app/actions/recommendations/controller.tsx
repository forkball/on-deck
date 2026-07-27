import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { listFollowedUsers } from '../../data/follows.ts'
import type { User } from '../../data/schema.ts'
import { generateRecommendations, listRecommendations } from '../../data/recommendations.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { RecommendationsPage } from './page.tsx'

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
      const { results, groupLabel } = await listRecommendations(db, auth.identity.id)
      const friends = await listFollowedUsers(db, auth.identity.id)

      return context.render(
        <RecommendationsPage
          recommendations={results}
          groupLabel={groupLabel}
          friends={friends}
          generated={context.url.searchParams.get('generated') === '1'}
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

      const db = context.get(Database)
      await generateRecommendations(db, auth.identity.id, [auth.identity.id, ...friendIds])

      return redirect(`${routes.recommendations.index.href()}?generated=1`, 303)
    },
  },
})
