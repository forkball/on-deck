import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { letterboxdSyncAvailableTo } from '../../data/imports/letterboxdFeed.ts'
import { syncLetterboxdBeforeReading } from '../../data/imports/letterboxdSync.ts'
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
import { composeTitle, parseTitleChoice } from '../../data/profileTitles/catalog.ts'
import {
  checkTitleUnlocksQuietly,
  chooseTitle,
  loadUnlockedTitleKeys,
  loadWornTitle,
} from '../../data/profileTitles/unlocks.ts'
import { updateMediaOrder, updateProfileSettings, updateWatchRegion } from '../../data/users.ts'
import { parseWatchRegion } from '../../data/watchRegion.ts'

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
  parseMediaOrder,
  parseMediaType,
  serializeMediaOrder,
} from '../../mediaTypes.ts'
import { parseInteractionStatus } from '../../interactionStatus.ts'
import { FollowListPage } from '../../ui/pages/follow-list-page.tsx'
import { PROFILE_TABS } from './edit/page.tsx'
import { ImportPage } from './import-page.tsx'
import { TITLES_TAB } from '../../ui/components/credit-tiles.tsx'
import { ProfilePage } from './page.tsx'
import { loadWaitingImports } from './waiting-imports.tsx'
import { ProfileWatchedPage } from './watched-page.tsx'
import { safeReturnPath } from '../../ui/backLink.ts'

const RECENT_COUNT = 5
const PAGE_SIZE = 10

export default createController(routes.profile, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)

      const db = context.get(Database)
      const mediaOrder = parseMediaOrder(auth.identity.media_order)
      const tab = context.url.searchParams.get('tab')
      const activeTab = tab === TITLES_TAB ? TITLES_TAB : (parseMediaType(tab) ?? mediaOrder[0])

      // Only the log waits on the feed; everything else loads alongside it. The
      // title check waits too, so whatever the feed just logged can earn one.
      const [[media, [check, worn]], followingCount, followersCount, rebuildAllowance, waitingImports] =
        await Promise.all([
          syncLetterboxdBeforeReading(db, auth.identity).then(() =>
            Promise.all([
              loadMediaSummaries(db, auth.identity.id, RECENT_COUNT),
              checkTitleUnlocksQuietly(db, auth.identity.id).then((result) =>
                Promise.all([result, loadWornTitle(db, auth.identity.id)]),
              ),
            ]),
          ),
          countFollowing(db, auth.identity.id),
          countFollowers(db, auth.identity.id),
          getProfileRebuildAllowance(db, auth.identity),
          loadWaitingImports(db, auth.identity.id),
        ])

      return context.render(
        <ProfilePage
          media={media}
          activeTab={activeTab}
          mediaOrder={mediaOrder}
          bio={auth.identity.bio ?? ''}
          followingCount={followingCount}
          followersCount={followersCount}
          saved={context.url.searchParams.get('saved') === '1'}
          settings={profileSettingsFor(auth.identity)}
          rebuildsLeft={rebuildAllowance.unlimited ? null : rebuildAllowance.remaining}
          rebuilt={context.url.searchParams.get('rebuilt') === '1'}
          rebuildError={context.url.searchParams.get('rebuildError') ?? undefined}
          waitingImports={waitingImports}
          displayName={displayLabel(auth.identity)}
          title={composeTitle(worn.adjective, worn.noun)}
          worn={worn}
          isAdmin={auth.identity.is_admin}
          titleSaved={context.url.searchParams.get('titleSaved') === '1'}
          credits={(check?.progress ?? []).map(({ title, current }) => ({
            title,
            earned: check?.unlocked.has(title.key) ?? false,
            current,
          }))}
        />,
      )
    },

    async import(context) {
      const auth = context.get(Auth)

      return context.render(
        <ImportPage
          displayName={displayLabel(auth.identity)}
          sources={{
            letterboxdAvailable: letterboxdSyncAvailableTo(auth.identity),
            letterboxdConnected: auth.identity.letterboxd_username != null,
            steamConnected: auth.identity.steam_id != null,
          }}
          waitingImports={await loadWaitingImports(context.get(Database), auth.identity.id)}
        />,
      )
    },

    async title(context) {
      const auth = context.get(Auth)
      const formData = context.get(FormData)
      const db = context.get(Database)

      const choice = parseTitleChoice(
        {
          adjective: String(formData.get('adjective') ?? ''),
          noun: String(formData.get('noun') ?? ''),
        },
        await loadUnlockedTitleKeys(db, auth.identity.id),
      )
      if (!choice) return new Response("You haven't earned that title.", { status: 400 })

      await chooseTitle(db, auth.identity.id, choice)
      // Back to your profile's Titles tab, which the tap came from, with the
      // toast that says it took.
      const back =
        safeReturnPath(String(formData.get('return_to') ?? '')) ??
        `${routes.profile.index.href()}?tab=${TITLES_TAB}`
      return redirect(`${back}${back.includes('?') ? '&' : '?'}titleSaved=1`, 303)
    },

    async settings(context) {
      const auth = context.get(Auth)

      const formData = context.get(FormData)
      await updateProfileSettings(context.get(Database), auth.identity.id, {
        logLimit: parseProfileLogLimit(String(formData.get('log_limit') ?? '')),
        // An unchecked checkbox sends nothing at all, so the missing key is
        // the "off" — same shape as is_private on the edit form.
        useNotes: formData.get('use_notes') != null,
      })

      return redirect(`${routes.profile.edit.index.href()}?tab=taste&saved=1`, 303)
    },

    // Posted by the move buttons on the settings tab, each carrying the whole
    // order it would leave. Parsed rather than trusted, so a hand-made value can
    // only ever come out as some order of the real types.
    async mediaOrder(context) {
      const auth = context.get(Auth)
      const formData = context.get(FormData)

      const order = parseMediaOrder(String(formData.get('media_order') ?? ''))
      await updateMediaOrder(context.get(Database), auth.identity.id, serializeMediaOrder(order))

      return redirect(`${routes.profile.edit.index.href()}?tab=${PROFILE_TABS.mediaOrder}`, 303)
    },

    // Posted from a detail page's "where to watch" list, and sends you back to
    // it. A value not in the list is ignored rather than stored, since it could
    // only ever show nothing.
    async watchRegion(context) {
      const auth = context.get(Auth)
      const formData = context.get(FormData)

      const region = parseWatchRegion(formData.get('region'))
      if (region) await updateWatchRegion(context.get(Database), auth.identity.id, region)

      return redirect(safeReturnPath(String(formData.get('return_to') ?? '')) ?? routes.home.href(), 303)
    },

    async rebuild(context) {
      const auth = context.get(Auth)

      const mediaType = parseMediaType(context.params.mediaType)
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

      const db = context.get(Database)
      const page = Math.max(1, Number(context.url.searchParams.get('page')) || 1)
      const mediaType = parseMediaType(context.url.searchParams.get('type')) ?? DEFAULT_MEDIA_TYPE
      const status = parseInteractionStatus(context.url.searchParams.get('status'))
      const filter = {
        type: mediaType,
        statuses: status ? [status] : undefined,
      }

      await syncLetterboxdBeforeReading(db, auth.identity)

      // Counted through the same filter, or the last page of a filtered list
      // pages past its own end.
      const [totalWatched, movieLog] = await Promise.all([
        countUserMediaLog(db, auth.identity.id, filter),
        listUserMediaLog(db, auth.identity.id, {
          ...filter,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
      ])

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

      const db = context.get(Database)
      const users = await listFollowedUsers(db, auth.identity.id)
      const followingIds = await listFollowingIds(
        db,
        auth.identity.id,
        users.map((u) => u.id),
      )

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

      const db = context.get(Database)
      const users = await listFollowers(db, auth.identity.id)
      const followingIds = await listFollowingIds(
        db,
        auth.identity.id,
        users.map((u) => u.id),
      )

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
