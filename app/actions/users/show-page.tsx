import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaSummaries } from '../../data/mediaSummary.ts'
import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../utils/mediaTypes.ts'
import type { listUserMediaLog } from '../../data/mediaCatalog.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

type MediaLog = Awaited<ReturnType<typeof listUserMediaLog>>

export interface UserProfilePageProps {
  user: User
  media: MediaSummaries
  activeTab: ActiveMediaType
  bio: string
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

export function UserProfilePage(handle: Handle<UserProfilePageProps>) {
  return () => {
    const { user, media, activeTab, bio, followingCount, followersCount, displayName } = handle.props
    const label = displayLabel(user)
    const returnTo = routes.users.show.href({ userId: String(user.id) })

    return (
      <Document title={`${label} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{label}</h1>
          <p mix={css({ margin: '-8px 0 16px', color: '#555' })}>
            <a href={routes.users.following.href({ userId: String(user.id) })}>{followingCount} following</a> ·{' '}
            <a href={routes.users.followers.href({ userId: String(user.id) })}>
              {followersCount} follower{followersCount === 1 ? '' : 's'}
            </a>
          </p>

          {bio && <p mix={css({ whiteSpace: 'pre-wrap' })}>{bio}</p>}

          <MediaTabs
            idPrefix="user-profile"
            active={activeTab}
            panels={Object.fromEntries(
              ACTIVE_MEDIA_TYPES.map((type) => {
                const ui = MEDIA_TYPE_UI[type]
                const { summary, log, total } = media[type]
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
                        `${ui.hrefs.show(id)}?from=${encodeURIComponent(`${returnTo}?tab=${type}`)}`
                      }
                      seeAllHref={type === 'movie' ? watchedHref : `${watchedHref}?type=${type}`}
                    />
                  </>,
                ]
              }),
            )}
          />
        </main>
      </Document>
    )
  }
}
