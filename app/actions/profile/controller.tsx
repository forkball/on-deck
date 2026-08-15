import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  getProfileRebuildAllowance,
  recordProfileRebuild,
  timeUntil,
} from '../../data/recommendations/dailyLimit.ts'
import {
  parseProfileLogLimit,
  profileSettingsFor,
  regenerateTasteProfile,
} from '../../data/recommendations/tasteProfile.ts'
import { updateProfileSettings } from '../../data/users.ts'

import {
  countFollowers,
  countFollowing,
  listFollowedUsers,
  listFollowers,
  listFollowingIds,
} from '../../data/follows.ts'
import { CONSUMPTION_STATUSES, countUserMediaLog, listUserMediaLog } from '../../data/mediaItems.ts'
import { loadMediaSummaries } from '../../data/mediaSummary.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import {
  DEFAULT_MEDIA_TYPE,
  mediaTypeUiFor,
  parseEnabledMediaType,
  parseInteractionStatus,
} from '../../mediaTypes.ts'
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
      const activeTab = parseEnabledMediaType(context.url.searchParams.get('tab')) ?? DEFAULT_MEDIA_TYPE

      const followingCount = await countFollowing(db, auth.identity.id)
      const followersCount = await countFollowers(db, auth.identity.id)
      const rebuildAllowance = await getProfileRebuildAllowance(db, auth.identity)

      return context.render(
        <ProfilePage
          media={media}
          activeTab={activeTab}
          bio={auth.identity.bio ?? ''}
          followingCount={followingCount}
          followersCount={followersCount}
          saved={context.url.searchParams.get('saved') === '1'}
          settings={profileSettingsFor(auth.identity)}
          rebuildsLeft={rebuildAllowance.unlimited ? null : rebuildAllowance.remaining}
          rebuilt={context.url.searchParams.get('rebuilt') === '1'}
          rebuildError={context.url.searchParams.get('rebuildError') ?? undefined}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async settings(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)
      await updateProfileSettings(context.get(Database), auth.identity.id, {
        logLimit: parseProfileLogLimit(String(formData.get('log_limit') ?? '')),
        // An unchecked checkbox sends nothing at all, so the missing key is
        // the "off" — same shape as is_private on the edit form.
        useNotes: formData.get('use_notes') != null,
      })

      return redirect(`${routes.profile.edit.index.href()}?saved=1`, 303)
    },

    async rebuild(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaType = parseEnabledMediaType(context.params.mediaType)
      if (!mediaType) return new Response('Not Found', { status: 404 })

      const db = context.get(Database)

      const logged = await countUserMediaLog(db, auth.identity.id, {
        type: mediaType,
        statuses: CONSUMPTION_STATUSES,
      })
      if (logged === 0) {
        const noun = mediaTypeUiFor(mediaType).plural
        return redirect(
          `${routes.profile.index.href()}?tab=${mediaType}&rebuildError=${encodeURIComponent(
            `You have no ${noun} logged yet, so there's nothing to write a profile from.`,
          )}`,
          303,
        )
      }

      const allowance = await getProfileRebuildAllowance(db, auth.identity)
      if (!allowance.unlimited && allowance.remaining <= 0) {
        const wait = allowance.resetsAt ? timeUntil(allowance.resetsAt) : 'a while'
        return redirect(
          `${routes.profile.index.href()}?tab=${mediaType}&rebuildError=${encodeURIComponent(
            `You've used all ${allowance.limit} profile rebuilds for today — the next one frees up in ${wait}.`,
          )}`,
          303,
        )
      }

      // Counted before the call, not after: the spend is the model call, and
      // one that fails has already been made. Charging on success would make a
      // failing profile free to retry without limit.
      await recordProfileRebuild(db, auth.identity.id)
      await regenerateTasteProfile(db, auth.identity.id, mediaType, profileSettingsFor(auth.identity))

      return redirect(`${routes.profile.index.href()}?tab=${mediaType}&rebuilt=1`, 303)
    },

    async watched(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const page = Math.max(1, Number(context.url.searchParams.get('page')) || 1)
      const mediaType = parseEnabledMediaType(context.url.searchParams.get('type')) ?? DEFAULT_MEDIA_TYPE
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
