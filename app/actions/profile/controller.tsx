import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import {
  countFollowers,
  countFollowing,
  listFollowedUsers,
  listFollowers,
  listFollowingIds,
} from '../../data/follows.ts'
import { countUserMediaLog, listUserMediaLog } from '../../data/mediaItems.ts'
import { loadMediaSummaries } from '../../data/mediaSummary.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { DEFAULT_MEDIA_TYPE, parseEnabledMediaType, parseInteractionStatus } from '../../mediaTypes.ts'
import { FollowListPage } from '../../ui/pages/follow-list-page.tsx'
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
      const media = await loadMediaSummaries(db, auth.identity.id, RECENT_COUNT)
      // Which tab to open on — set when returning from a detail page.
      const activeTab = parseEnabledMediaType(context.url.searchParams.get('tab')) ?? DEFAULT_MEDIA_TYPE

      const followingCount = await countFollowing(db, auth.identity.id)
      const followersCount = await countFollowers(db, auth.identity.id)

      return context.render(
        <ProfilePage
          media={media}
          activeTab={activeTab}
          bio={auth.identity.bio ?? ''}
          followingCount={followingCount}
          followersCount={followersCount}
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
      const mediaType = parseEnabledMediaType(context.url.searchParams.get('type')) ?? DEFAULT_MEDIA_TYPE
      // Unlike the profile page, this one shows every status — it's the full
      // log, including what you've declined, which is the only place you can
      // find those again to undo them. Null means no filter.
      const status = parseInteractionStatus(context.url.searchParams.get('status'))
      const filter = { type: mediaType, statuses: status ? [status] : undefined }

      // Counted through the same filter, or the last page of a filtered list
      // pages past its own end.
      const totalWatched = await countUserMediaLog(db, auth.identity.id, filter)
      const movieLog = await listUserMediaLog(db, auth.identity.id, {
        ...filter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

      return context.render(
        <ProfileWatchedPage
          movieLog={movieLog}
          mediaType={mediaType}
          status={status}
          page={page}
          totalPages={Math.max(1, Math.ceil(totalWatched / PAGE_SIZE))}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async following(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const users = await listFollowedUsers(db, auth.identity.id)
      const followingIds = await listFollowingIds(db, auth.identity.id, users.map((u) => u.id))

      return context.render(
        <FollowListPage
          title="Following"
          heading="Following"
          users={users}
          viewerId={auth.identity.id}
          followingByUserId={new Map(users.map((u) => [u.id, followingIds.has(u.id)]))}
          emptyMessage="You're not following anyone yet."
          returnTo={routes.profile.following.href()}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async followers(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const users = await listFollowers(db, auth.identity.id)
      const followingIds = await listFollowingIds(db, auth.identity.id, users.map((u) => u.id))

      return context.render(
        <FollowListPage
          title="Followers"
          heading="Followers"
          users={users}
          viewerId={auth.identity.id}
          followingByUserId={new Map(users.map((u) => [u.id, followingIds.has(u.id)]))}
          emptyMessage="No one follows you yet."
          returnTo={routes.profile.followers.href()}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },
  },
})
