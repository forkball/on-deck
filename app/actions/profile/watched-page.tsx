import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MovieLogEditModal } from '../../ui/components/movie-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { Pagination } from '../../ui/components/pagination.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

export interface ProfileWatchedPageProps {
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  page: number
  totalPages: number
  displayName: string
}

export function ProfileWatchedPage(handle: Handle<ProfileWatchedPageProps>) {
  return () => {
    const { movieLog, page, totalPages, displayName } = handle.props
    const returnTo = `${routes.profile.watched.href()}?page=${page}`

    return (
      <Document title="What I've watched | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <p>
            <a href={routes.profile.index.href()}>← Back to profile</a>
          </p>
          <h1>What I've watched</h1>

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
                  actions={
                    <MovieLogEditModal
                      interaction={interaction}
                      title={item?.title ?? 'Unknown title'}
                      returnTo={returnTo}
                    />
                  }
                />
              )
            })}
          </ul>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              pageHref={(p) => `${routes.profile.watched.href()}?page=${p}`}
            />
          )}
        </main>
      </Document>
    )
  }
}
