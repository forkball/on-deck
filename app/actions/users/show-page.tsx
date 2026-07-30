import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

type MediaLog = Awaited<ReturnType<typeof listUserMovieLog>>

export interface UserProfilePageProps {
  user: User
  movieSummary: string
  bio: string
  movieLog: MediaLog
  totalWatched: number
  tvSummary: string
  tvLog: MediaLog
  totalTv: number
  followingCount: number
  followersCount: number
  displayName: string
}

function TasteProfileSummary(handle: Handle<{ label: string; summary: string }>) {
  return () => {
    const { label, summary } = handle.props

    return (
      <details mix={css({ marginBottom: '24px' })}>
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
    const {
      user,
      movieSummary,
      bio,
      movieLog,
      totalWatched,
      tvSummary,
      tvLog,
      totalTv,
      followingCount,
      followersCount,
      displayName,
    } = handle.props
    const label = displayLabel(user)
    const returnTo = routes.users.show.href({ userId: String(user.id) })

    return (
      <Document title={`${label} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <p>
            <a href={routes.users.search.href()}>← Back to search</a>
          </p>
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
            movies={
              <>
                <TasteProfileSummary label={`${label}'s movie taste profile`} summary={movieSummary} />
                <h2>What {label} has watched</h2>
                <LoggedList
                  log={movieLog}
                  total={totalWatched}
                  detailHref={(id) => `${routes.movies.show.href({ mediaItemId: String(id) })}?from=${encodeURIComponent(returnTo)}`}
                  seeAllHref={routes.users.watched.href({ userId: String(user.id) })}
                />
              </>
            }
            tv={
              <>
                <TasteProfileSummary label={`${label}'s TV taste profile`} summary={tvSummary} />
                <h2>What {label} has watched</h2>
                <LoggedList
                  log={tvLog}
                  total={totalTv}
                  detailHref={(id) => `${routes.tv.show.href({ mediaItemId: String(id) })}?from=${encodeURIComponent(returnTo)}`}
                />
              </>
            }
          />
        </main>
      </Document>
    )
  }
}
