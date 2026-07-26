import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { listUserMovieLog } from '../../data/movies.ts'
import { getTasteProfile, parseProfile, upsertTasteProfile } from '../../data/tasteProfile.ts'
import type { User } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { ProfilePage } from './page.tsx'

const profileSchema = f.object({
  summary: f.field(s.defaulted(s.string(), '')),
  liked_tags: f.field(s.defaulted(s.string(), '')),
  disliked_tags: f.field(s.defaulted(s.string(), '')),
})

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}

export default createController(routes.profile, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const row = await getTasteProfile(db, auth.identity.id)
      const data = parseProfile(row)
      const movieLog = await listUserMovieLog(db, auth.identity.id)

      return context.render(
        <ProfilePage
          summary={row?.summary ?? ''}
          likedTags={data.liked_tags}
          dislikedTags={data.disliked_tags}
          movieLog={movieLog}
          saved={context.url.searchParams.get('saved') === '1'}
        />,
      )
    },

    async update(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)
      const parsed = s.parseSafe(profileSchema, formData)
      if (!parsed.success) {
        return new Response('Invalid profile input', { status: 400 })
      }

      const db = context.get(Database)
      await upsertTasteProfile(db, auth.identity.id, {
        summary: parsed.value.summary,
        liked_tags: splitTags(parsed.value.liked_tags),
        disliked_tags: splitTags(parsed.value.disliked_tags),
      })

      return redirect(`${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
