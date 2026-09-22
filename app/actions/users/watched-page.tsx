import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMediaLog } from '../../data/mediaItems.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { Pagination } from '../../ui/components/pagination.tsx'
import { WatchedList } from '../../ui/components/watched-list.tsx'
import { MEDIA_TYPE_UI, mediaTypeQuery, type ActiveMediaType } from '../../mediaTypes.ts'

export interface UserWatchedPageProps {
  user: User
  movieLog: Awaited<ReturnType<typeof listUserMediaLog>>
  mediaType: ActiveMediaType
  page: number
  totalPages: number
  displayName: string
}

export function UserWatchedPage(handle: Handle<UserWatchedPageProps>) {
  return () => {
    const { user, movieLog, mediaType, page, totalPages, displayName } = handle.props
    const label = displayLabel(user)
    const watchedHref = routes.users.watched.href({ userId: String(user.id) })
    const ui = MEDIA_TYPE_UI[mediaType]
    const typeQuery = mediaTypeQuery(mediaType)
    const returnTo = `${watchedHref}?page=${page}${typeQuery}`
    const noun = ui.tabLabel
    // See the profile copy of this page — the verb is per medium.
    const heading = `What ${label} has ${ui.pastParticiple} (${noun})`

    return (
      <Document title={`${heading} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{heading}</h1>

          {/* No actions: this is someone else's log, not yours to edit. */}
          <WatchedList log={movieLog} mediaType={mediaType} returnTo={returnTo} />

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              pageHref={(p) => `${watchedHref}?page=${p}${typeQuery}`}
            />
          )}
        </main>
      </Document>
    )
  }
}
