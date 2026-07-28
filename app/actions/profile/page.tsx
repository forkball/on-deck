import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MovieLogEditModal } from '../../ui/components/movie-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

export interface ProfilePageProps {
  summary: string
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  totalWatched: number
  followingCount: number
  followersCount: number
  saved?: boolean
  displayName: string
}

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const { summary, movieLog, totalWatched, followingCount, followersCount, saved, displayName } = handle.props
    const profileHref = routes.profile.index.href()

    return (
      <Document title="My profile | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{displayName}</h1>
          <p mix={css({ margin: '-8px 0 16px', color: '#555' })}>
            <a href={routes.profile.following.href()}>{followingCount} following</a> ·{' '}
            <a href={routes.profile.followers.href()}>
              {followersCount} follower{followersCount === 1 ? '' : 's'}
            </a>
          </p>
          <h2>My taste profile</h2>
          {saved && <p mix={css({ color: '#15803d' })}>Saved.</p>}

          <div
            mix={css({
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
            })}
          >
            {summary ? (
              <p mix={css({ margin: 0 })}>{summary}</p>
            ) : (
              <p mix={css({ margin: 0, color: '#555' })}>
                Nothing yet — <a href={routes.recommendations.index.href()}>get recommendations</a> to have
                one written from what you've logged.
              </p>
            )}
          </div>

          <section mix={css({ marginTop: '40px' })}>
            <div mix={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' })}>
              <h2>What I've watched</h2>
              <a href={routes.profile.import.index.href()} mix={css({ fontSize: '13px' })}>
                Import from Letterboxd
              </a>
            </div>
            {movieLog.length === 0 ? (
              <p>
                Nothing logged yet — <a href={routes.movies.search.href()}>search for a movie</a> to
                get started.
              </p>
            ) : (
              <>
                <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                  {movieLog.map(({ interaction, item }) => {
                    const detailHref = item
                      ? `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(profileHref)}`
                      : '#'

                    return (
                      <WatchedListItem
                        key={interaction.id}
                        interaction={interaction}
                        item={item}
                        detailHref={detailHref}
                        actions={
                          <MovieLogEditModal
                            interaction={interaction}
                            title={item?.title ?? 'Unknown title'}
                            returnTo={`${profileHref}?saved=1`}
                          />
                        }
                      />
                    )
                  })}
                </ul>
                {totalWatched > movieLog.length && (
                  <p mix={css({ marginTop: '16px' })}>
                    <a href={routes.profile.watched.href()}>See all {totalWatched} →</a>
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
