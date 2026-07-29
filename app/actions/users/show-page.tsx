import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

export interface UserProfilePageProps {
  user: User
  summary: string
  bio: string
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  totalWatched: number
  followingCount: number
  followersCount: number
  displayName: string
}

export function UserProfilePage(handle: Handle<UserProfilePageProps>) {
  return () => {
    const { user, summary, bio, movieLog, totalWatched, followingCount, followersCount, displayName } = handle.props
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

          <details open mix={css({ marginTop: '24px' })}>
            <summary mix={css({ cursor: 'pointer' })}>
              <h2 mix={css({ display: 'inline' })}>{label}'s taste profile</h2>
            </summary>
            <div
              mix={css({
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '16px',
                marginTop: '12px',
              })}
            >
              {summary ? (
                <p mix={css({ margin: 0 })}>{summary}</p>
              ) : (
                <p mix={css({ margin: 0, color: '#555' })}>Nothing written yet.</p>
              )}
            </div>
          </details>

          <section mix={css({ marginTop: '40px' })}>
            <h2>What {label} has watched</h2>
            {movieLog.length === 0 ? (
              <p>Nothing logged yet.</p>
            ) : (
              <>
                <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                  {movieLog.map(({ interaction, item }) => {
                    const detailHref = item
                      ? `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(returnTo)}`
                      : '#'

                    return (
                      <WatchedListItem
                        key={interaction.id}
                        interaction={interaction}
                        item={item}
                        detailHref={detailHref}
                      />
                    )
                  })}
                </ul>
                {totalWatched > movieLog.length && (
                  <p mix={css({ marginTop: '16px' })}>
                    <a href={routes.users.watched.href({ userId: String(user.id) })}>
                      See all {totalWatched} →
                    </a>
                  </p>
                )}
              </>
            )}
          </section>
        </main>
      </Document>
    )
  }
}
