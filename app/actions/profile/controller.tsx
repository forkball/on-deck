import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { countUserMovieLog, listUserMovieLog } from '../../data/movies.ts'
import { getTasteProfile } from '../../data/tasteProfile.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { ProfilePage } from './page.tsx'
import { ProfileWatchedPage } from './watched-page.tsx'

const RECENT_COUNT = 5
const PAGE_SIZE = 10

export default createController(routes.profile, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const row = await getTasteProfile(db, auth.identity.id)
      const movieLog = await listUserMovieLog(db, auth.identity.id, { limit: RECENT_COUNT })
      const totalWatched = await countUserMovieLog(db, auth.identity.id)

      return context.render(
        <ProfilePage
          summary={row?.summary ?? ''}
          movieLog={movieLog}
          totalWatched={totalWatched}
          saved={context.url.searchParams.get('saved') === '1'}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async watched(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const page = Math.max(1, Number(context.url.searchParams.get('page')) || 1)
      const totalWatched = await countUserMovieLog(db, auth.identity.id)
      const movieLog = await listUserMovieLog(db, auth.identity.id, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

      return context.render(
        <ProfileWatchedPage
          movieLog={movieLog}
          page={page}
          totalPages={Math.max(1, Math.ceil(totalWatched / PAGE_SIZE))}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },
  },
})
