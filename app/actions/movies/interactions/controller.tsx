import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { updateInteraction, type LogInteractionInput } from '../../../data/movies.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import type { User } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { parseRatingInput } from '../../../utils/stars.ts'

const updateSchema = f.object({
  status: f.field(
    s.union([
      s.literal('want_to_consume'),
      s.literal('in_progress'),
      s.literal('consumed'),
    ]),
  ),
  rating: f.field(s.defaulted(s.string(), '')),
  notes: f.field(s.defaulted(s.string(), '')),
  return_to: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.movies.interactions, {
  middleware: [requireAuth<User>()],
  actions: {
    async update(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const interactionId = Number(context.params.interactionId)
      const formData = context.get(FormData)
      const parsed = s.parseSafe(updateSchema, formData)

      if (!parsed.success) {
        return new Response('Invalid input', { status: 400 })
      }

      const db = context.get(Database)
      const updated = await updateInteraction(db, interactionId, auth.identity.id, {
        status: parsed.value.status as LogInteractionInput['status'],
        rating: parseRatingInput(parsed.value.rating),
        notes: parsed.value.notes || null,
      })

      if (!updated) {
        return new Response('Not Found', { status: 404 })
      }

      return redirect(parsed.value.return_to || `${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
