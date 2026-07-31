import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { Modal } from '../../ui/components/modal.tsx'
import { MovieLogEditModal } from '../../ui/components/movie-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

type MediaLog = Awaited<ReturnType<typeof listUserMovieLog>>

export interface ProfilePageProps {
  movieSummary: string
  bio: string
  movieLog: MediaLog
  totalWatched: number
  tvSummary: string
  tvLog: MediaLog
  totalTv: number
  followingCount: number
  followersCount: number
  saved?: boolean
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
            <p mix={css({ margin: 0, color: '#555' })}>
              Nothing yet — <a href={routes.recommendations.index.href()}>get recommendations</a> to have one
              written from what you've logged.
            </p>
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
    emptyHref: string
    emptyLabel: string
    returnTo: string
  }>,
) {
  return () => {
    const { log, total, detailHref, seeAllHref, emptyHref, emptyLabel, returnTo } = handle.props

    if (log.length === 0) {
      return (
        <p>
          Nothing logged yet — <a href={emptyHref}>{emptyLabel}</a> to get started.
        </p>
      )
    }

    return (
      <>
        <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
          {log.map(({ interaction, item }) => (
            <WatchedListItem
              key={interaction.id}
              interaction={interaction}
              item={item}
              detailHref={item ? detailHref(item.id) : '#'}
              actions={
                <MovieLogEditModal interaction={interaction} title={item?.title ?? 'Unknown title'} returnTo={returnTo} />
              }
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

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const {
      movieSummary,
      bio,
      movieLog,
      totalWatched,
      tvSummary,
      tvLog,
      totalTv,
      followingCount,
      followersCount,
      saved,
      displayName,
    } = handle.props
    const profileHref = routes.profile.index.href()
    const savedReturnTo = `${profileHref}?saved=1`

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
          {saved && <p mix={css({ color: '#15803d' })}>Saved.</p>}

          <h2>Bio</h2>
          <div
            mix={css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
            })}
          >
            {bio ? (
              <p mix={css({ margin: 0, whiteSpace: 'pre-wrap' })}>{bio}</p>
            ) : (
              <p mix={css({ margin: 0, color: '#555' })}>
                Nothing yet — just for other people to read, it has no effect on your recommendations.
              </p>
            )}
            <Modal id="edit-bio" triggerLabel="Edit" title="Edit your bio">
              <form
                method="post"
                action={routes.profile.updateBio.href()}
                mix={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}
              >
                <input type="hidden" name="_method" value="PUT" />
                <textarea name="bio" rows={4} defaultValue={bio} placeholder="Tell people a bit about yourself…" />
                <p mix={css({ margin: 0, fontSize: '12px', color: '#888' })}>
                  Just for other people to read — it has no effect on your recommendations.
                </p>
                <button type="submit">Save bio</button>
              </form>
            </Modal>
          </div>

          <MediaTabs
            idPrefix="profile"
            movies={
              <>
                <TasteProfileSummary label="My movie taste profile" summary={movieSummary} />
                <div mix={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' })}>
                  <h2>What I've watched</h2>
                  <a href={routes.profile.import.index.href()} mix={css({ fontSize: '13px', textAlign: 'right' })}>
                    Import from Letterboxd
                  </a>
                </div>
                <LoggedList
                  log={movieLog}
                  total={totalWatched}
                  detailHref={(id) => `${routes.movies.show.href({ mediaItemId: String(id) })}?from=${encodeURIComponent(profileHref)}`}
                  seeAllHref={routes.profile.watched.href()}
                  emptyHref={routes.movies.search.href()}
                  emptyLabel="search for a movie"
                  returnTo={savedReturnTo}
                />
              </>
            }
            tv={
              <>
                <TasteProfileSummary label="My TV taste profile" summary={tvSummary} />
                <h2>What I've watched</h2>
                <LoggedList
                  log={tvLog}
                  total={totalTv}
                  detailHref={(id) => `${routes.tv.show.href({ mediaItemId: String(id) })}?from=${encodeURIComponent(profileHref)}`}
                  seeAllHref={`${routes.profile.watched.href()}?type=tv`}
                  emptyHref={routes.tv.search.href()}
                  emptyLabel="search for a TV show"
                  returnTo={savedReturnTo}
                />
              </>
            }
          />
        </main>
      </Document>
    )
  }
}
