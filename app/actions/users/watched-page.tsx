import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { Pagination } from '../../ui/components/pagination.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

export interface UserWatchedPageProps {
  user: User
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  page: number
  totalPages: number
  displayName: string
}

export function UserWatchedPage(handle: Handle<UserWatchedPageProps>) {
  return () => {
    const { user, movieLog, page, totalPages, displayName } = handle.props
    const label = displayLabel(user)
    const watchedHref = routes.users.watched.href({ userId: String(user.id) })
    const returnTo = `${watchedHref}?page=${page}`

    return (
      <Document title={`What ${label} has watched | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <p>
            <a href={routes.users.show.href({ userId: String(user.id) })}>← Back to {label}'s profile</a>
          </p>
          <h1>What {label} has watched</h1>

          <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
            {movieLog.map(({ interaction, item }) => {
              const detailHref = item
                ? `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(returnTo)}`
                : '#'

              return (
                <WatchedListItem key={interaction.id} interaction={interaction} item={item} detailHref={detailHref} />
              )
            })}
          </ul>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} pageHref={(p) => `${watchedHref}?page=${p}`} />
          )}
        </main>
      </Document>
    )
  }
}
