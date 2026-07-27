import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import type { Db } from '../../data/db.ts'
import { countUserMovieLog, listUserMovieLog } from '../../data/movies.ts'
import { followUser, isFollowing, listFollowingIds, unfollowUser } from '../../data/follows.ts'
import { getTasteProfile } from '../../data/tasteProfile.ts'
import { users, type User } from '../../data/schema.ts'
import { displayLabel, searchUsers } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { UserSearchPage } from './search-page.tsx'
import { UserProfilePage } from './show-page.tsx'
import { UserWatchedPage } from './watched-page.tsx'

const RECENT_COUNT = 5
const PAGE_SIZE = 10

async function requireFollowedUser(db: Db, followerId: number, userId: number): Promise<User | Response> {
  if (!(await isFollowing(db, followerId, userId))) {
    return new Response('Forbidden', { status: 403 })
  }
  const user = await db.find(users, userId)
  if (!user) return new Response('Not Found', { status: 404 })
  return user
}

export default createController(routes.users, {
  middleware: [requireAuth<User>()],
  actions: {
    async search(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const query = context.url.searchParams.get('q')?.trim() ?? ''
      const results = query ? await searchUsers(db, query, auth.identity.id) : []
      const followingIds = await listFollowingIds(db, auth.identity.id, results.map((r) => r.id))
      const followingByUserId = new Map(results.map((r) => [r.id, followingIds.has(r.id)]))

      return context.render(
        <UserSearchPage
          query={query}
          results={results}
          followingByUserId={followingByUserId}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async show(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      if (userId === auth.identity.id) return redirect(routes.profile.index.href(), 303)

      const db = context.get(Database)
      const target = await requireFollowedUser(db, auth.identity.id, userId)
      if (target instanceof Response) return target

      const row = await getTasteProfile(db, userId)
      const movieLog = await listUserMovieLog(db, userId, { limit: RECENT_COUNT })
      const totalWatched = await countUserMovieLog(db, userId)

      return context.render(
        <UserProfilePage
          user={target}
          summary={row?.summary ?? ''}
          movieLog={movieLog}
          totalWatched={totalWatched}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async watched(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      const db = context.get(Database)
      const target = await requireFollowedUser(db, auth.identity.id, userId)
      if (target instanceof Response) return target

      const page = Math.max(1, Number(context.url.searchParams.get('page')) || 1)
      const totalWatched = await countUserMovieLog(db, userId)
      const movieLog = await listUserMovieLog(db, userId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

      return context.render(
        <UserWatchedPage
          user={target}
          movieLog={movieLog}
          page={page}
          totalPages={Math.max(1, Math.ceil(totalWatched / PAGE_SIZE))}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async follow(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      const db = context.get(Database)
      await followUser(db, auth.identity.id, userId)

      const formData = context.get(FormData)
      const returnTo = String(formData.get('return_to') || '')
      return redirect(returnTo || routes.users.search.href(), 303)
    },

    async unfollow(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      const db = context.get(Database)
      await unfollowUser(db, auth.identity.id, userId)

      const formData = context.get(FormData)
      const returnTo = String(formData.get('return_to') || '')
      return redirect(returnTo || routes.users.search.href(), 303)
    },
  },
})
