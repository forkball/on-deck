import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { deleteInteraction, parseRatingSubmission, updateInteraction } from '../../data/mediaItems.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { INTERACTION_STATUSES, type User } from '../../data/schema.ts'
import { routes } from '../../routes.ts'

const updateSchema = f.object({
  status: f.field(s.enum_(INTERACTION_STATUSES)),
  rating: f.field(s.defaulted(s.string(), '')),
  notes: f.field(s.defaulted(s.string(), '')),
  return_to: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.interactions, {
  middleware: [requireAuth<User>()],
  actions: {
    async update(context) {
      const auth = context.get(Auth)

      const interactionId = Number(context.params.interactionId)
      const formData = context.get(FormData)
      const parsed = s.parseSafe(updateSchema, formData)

      if (!parsed.success) {
        return new Response('Invalid input', { status: 400 })
      }

      // One field, two columns — see parseRatingSubmission.
      const { rating, disliked } = parseRatingSubmission(parsed.value.rating)

      const db = context.get(Database)
      const updated = await updateInteraction(db, interactionId, auth.identity.id, {
        status: parsed.value.status,
        rating,
        disliked,
        notes: parsed.value.notes || null,
      })

      if (!updated) {
        return new Response('Not Found', { status: 404 })
      }

      return redirect(parsed.value.return_to || `${routes.profile.index.href()}?saved=1`, 303)
    },

    async destroy(context) {
      const auth = context.get(Auth)

      const interactionId = Number(context.params.interactionId)
      const formData = context.get(FormData)
      const returnTo = String(formData.get('return_to') || '')

      const db = context.get(Database)
      const deleted = await deleteInteraction(db, interactionId, auth.identity.id)

      if (!deleted) {
        return new Response('Not Found', { status: 404 })
      }

      return redirect(returnTo || `${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
