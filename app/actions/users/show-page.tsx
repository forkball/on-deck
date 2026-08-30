import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaSummaries } from '../../data/mediaSummary.ts'
import {
  DEFAULT_MEDIA_TYPE,
  enabledMediaTypes,
  MEDIA_TYPE_UI,
  type ActiveMediaType,
} from '../../mediaTypes.ts'
import type { listUserMediaLog } from '../../data/mediaItems.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'
import { withReturnTo } from '../../ui/backLink.ts'

type MediaLog = Awaited<ReturnType<typeof listUserMediaLog>>

export interface UserProfilePageProps {
  user: User
  // True when the account is private and the viewer doesn't follow it —
  // renders the name and follow counts, but withholds the bio and log.
  locked: boolean
  viewerFollows: boolean
  // Absent when `locked` — there's nothing to show them.
  media?: MediaSummaries
  activeTab?: ActiveMediaType
  bio?: string
  followingCount: number
  followersCount: number
  displayName: string
}

function TasteProfileSummary(handle: Handle<{ label: string; summary: string }>) {
  return () => {
    const { label, summary } = handle.props

    return (
      <details>
        <summary mix={css({ cursor: 'pointer' })}>
          <h2 mix={css({ display: 'inline' })}>{label}</h2>
        </summary>
        <div mix={css({ border: '1px solid #ddd', borderRadius: '8px', padding: '16px', marginTop: '12px' })}>
          {summary ? (
            <p mix={css({ margin: 0 })}>{summary}</p>
          ) : (
            <p mix={css({ margin: 0, color: '#555' })}>Nothing written yet.</p>
          )}
        </div>
      </details>
    )
  }
}

function LoggedList(
  handle: Handle<{
    log: MediaLog
    total: number
    detailHref: (mediaItemId: number) => string
    seeAllHref?: string
  }>,
) {
  return () => {
    const { log, total, detailHref, seeAllHref } = handle.props

    if (log.length === 0) return <p>Nothing logged yet.</p>

    return (
      <>
        <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
          {log.map(({ interaction, item }) => (
            <WatchedListItem
              key={interaction.id}
              interaction={interaction}
              item={item}
              detailHref={item ? detailHref(item.id) : '#'}
            />
          ))}
        </ul>
        {seeAllHref && total > log.length && (
          <p mix={css({ marginTop: '16px' })}>
            <a href={seeAllHref}>See all {total} →</a>
          </p>
        )}
      </>
    )
  }
}

function FollowButton(handle: Handle<{ userId: number; following: boolean; returnTo: string }>) {
  return () => {
    const { userId, following, returnTo } = handle.props

    return (
      <form
        method="post"
        mix={css({ margin: '0 0 16px' })}
        action={
          following
            ? routes.users.unfollow.href({ userId: String(userId) })
            : routes.users.follow.href({ userId: String(userId) })
        }
      >
        <input type="hidden" name="return_to" value={returnTo} />
        <button type="submit" mix={css({ width: '100%', padding: '8px 12px' })}>
          {following ? 'Unfollow' : 'Follow'}
        </button>
      </form>
    )
  }
}

export function UserProfilePage(handle: Handle<UserProfilePageProps>) {
  return () => {
    const { user, locked, viewerFollows, media, activeTab, bio, followingCount, followersCount, displayName } =
      handle.props
    const label = displayLabel(user)
    const returnTo = routes.users.show.href({ userId: String(user.id) })

    return (
      <Document title={`${label} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1 mix={css({ margin: '0 0 4px', overflowWrap: 'break-word' })}>{label}</h1>
          <p mix={css({ margin: '0 0 12px', color: '#555' })}>
            {locked ? (
              <>
                {followingCount} following · {followersCount} follower{followersCount === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <a href={routes.users.following.href({ userId: String(user.id) })}>{followingCount} following</a> ·{' '}
                <a href={routes.users.followers.href({ userId: String(user.id) })}>
                  {followersCount} follower{followersCount === 1 ? '' : 's'}
                </a>
              </>
            )}
          </p>
          <FollowButton userId={user.id} following={viewerFollows} returnTo={returnTo} />

          {locked ? (
            <p>This profile is private. Follow {label} to see their bio and log.</p>
          ) : (
            <>
              {bio && <p mix={css({ whiteSpace: 'pre-wrap' })}>{bio}</p>}

              <MediaTabs
                idPrefix="user-profile"
                active={activeTab!}
                panels={Object.fromEntries(
                  enabledMediaTypes().map((type) => {
                    const ui = MEDIA_TYPE_UI[type]
                    const { summary, log, total } = media![type]
                    const watchedHref = routes.users.watched.href({ userId: String(user.id) })

                    return [
                      type,
                      <>
                        <TasteProfileSummary label={`${label}'s ${ui.attributive} taste profile`} summary={summary} />
                        <h2>
                          What {label} has {ui.pastParticiple}
                        </h2>
                        <LoggedList
                          log={log}
                          total={total}
                          detailHref={(id) =>
                            withReturnTo(ui.hrefs.show(id), `${returnTo}?tab=${type}`)
                          }
                          seeAllHref={
                            type === DEFAULT_MEDIA_TYPE ? watchedHref : `${watchedHref}?type=${type}`
                          }
                        />
                      </>,
                    ]
                  }),
                )}
              />
            </>
          )}
        </main>
      </Document>
    )
  }
}
