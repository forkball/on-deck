import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import type { Db } from '../../data/db.ts'
import { CONSUMPTION_STATUSES, countUserMediaLog, listUserMediaLog } from '../../data/mediaItems.ts'
import {
  countFollowers,
  countFollowing,
  followUser,
  isFollowing,
  listFollowedUsers,
  listFollowers,
  listFollowingIds,
  unfollowUser,
} from '../../data/follows.ts'
import { loadMediaSummaries } from '../../data/mediaSummary.ts'
import { users, type User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel, searchUsers } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { DEFAULT_MEDIA_TYPE, parseEnabledMediaType } from '../../mediaTypes.ts'
import { FollowListPage } from '../../ui/pages/follow-list-page.tsx'
import { UserSearchPage } from './search-page.tsx'
import { UserProfilePage } from './show-page.tsx'
import { UserWatchedPage } from './watched-page.tsx'

const RECENT_COUNT = 5
const PAGE_SIZE = 10
const SUGGESTION_LIMIT = 6

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

    async suggest(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      if (query.length < 2) return Response.json({ suggestions: [] })

      const db = context.get(Database)
      const results = await searchUsers(db, query, auth.identity.id)
      // No sublabel: it used to carry the email, which put every matched
      // account's address in a dropdown anyone could open.
      const suggestions = results.slice(0, SUGGESTION_LIMIT).map((user) => ({
        key: String(user.id),
        label: displayLabel(user),
      }))

      return Response.json({ suggestions })
    },

    async show(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      if (userId === auth.identity.id) return redirect(routes.profile.index.href(), 303)

      const db = context.get(Database)
      const target = await requireFollowedUser(db, auth.identity.id, userId)
      if (target instanceof Response) return target

      const media = await loadMediaSummaries(db, userId, RECENT_COUNT)
      const activeTab = parseEnabledMediaType(context.url.searchParams.get('tab')) ?? DEFAULT_MEDIA_TYPE

      const followingCount = await countFollowing(db, userId)
      const followersCount = await countFollowers(db, userId)

      return context.render(
        <UserProfilePage
          user={target}
          media={media}
          activeTab={activeTab}
          bio={target.bio ?? ''}
          followingCount={followingCount}
          followersCount={followersCount}
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
      const mediaType = parseEnabledMediaType(context.url.searchParams.get('type')) ?? DEFAULT_MEDIA_TYPE
      // Someone else's log, so no status filter and no declined items — what
      // they turned down is a note to themselves, not something to browse.
      const filter = { type: mediaType, statuses: CONSUMPTION_STATUSES }
      const totalWatched = await countUserMediaLog(db, userId, filter)
      const movieLog = await listUserMediaLog(db, userId, {
        ...filter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

      return context.render(
        <UserWatchedPage
          user={target}
          movieLog={movieLog}
          mediaType={mediaType}
          page={page}
          totalPages={Math.max(1, Math.ceil(totalWatched / PAGE_SIZE))}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async following(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      const db = context.get(Database)
      const target = await requireFollowedUser(db, auth.identity.id, userId)
      if (target instanceof Response) return target

      const label = displayLabel(target)
      const targetUsers = await listFollowedUsers(db, userId)
      const followingIds = await listFollowingIds(db, auth.identity.id, targetUsers.map((u) => u.id))

      return context.render(
        <FollowListPage
          title={`${label}'s following`}
          heading={`Who ${label} follows`}
          users={targetUsers}
          viewerId={auth.identity.id}
          followingByUserId={new Map(targetUsers.map((u) => [u.id, followingIds.has(u.id)]))}
          emptyMessage={`${label} isn't following anyone yet.`}
          returnTo={routes.users.following.href({ userId: String(userId) })}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async followers(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const userId = Number(context.params.userId)
      const db = context.get(Database)
      const target = await requireFollowedUser(db, auth.identity.id, userId)
      if (target instanceof Response) return target

      const label = displayLabel(target)
      const targetUsers = await listFollowers(db, userId)
      const followingIds = await listFollowingIds(db, auth.identity.id, targetUsers.map((u) => u.id))

      return context.render(
        <FollowListPage
          title={`${label}'s followers`}
          heading={`${label}'s followers`}
          users={targetUsers}
          viewerId={auth.identity.id}
          followingByUserId={new Map(targetUsers.map((u) => [u.id, followingIds.has(u.id)]))}
          emptyMessage={`No one follows ${label} yet.`}
          returnTo={routes.users.followers.href({ userId: String(userId) })}
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
