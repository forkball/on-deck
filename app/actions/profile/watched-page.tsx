import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMediaLog } from '../../data/mediaItems.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaLogEditModal } from '../../ui/components/media-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { Pagination } from '../../ui/components/pagination.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

export interface ProfileWatchedPageProps {
  movieLog: Awaited<ReturnType<typeof listUserMediaLog>>
  mediaType: ActiveMediaType
  page: number
  totalPages: number
  displayName: string
}

export function ProfileWatchedPage(handle: Handle<ProfileWatchedPageProps>) {
  return () => {
    const { movieLog, mediaType, page, totalPages, displayName } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const typeQuery = mediaType === 'movie' ? '' : `&type=${mediaType}`
    const returnTo = `${routes.profile.watched.href()}?page=${page}${typeQuery}`
    // Per-medium verb, not "watched" — the games tab read "What I've
    // watched (Games)". The registry already had the right word.
    const heading = `What I've ${ui.pastParticiple} (${ui.tabLabel})`

    return (
      <Document title={`${heading} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{heading}</h1>

          <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
            {movieLog.map(({ interaction, item }) => {
              const detailHref = item
                ? `${ui.hrefs.show(item.id)}?from=${encodeURIComponent(returnTo)}`
                : '#'

              return (
                <WatchedListItem
                  key={interaction.id}
                  interaction={interaction}
                  item={item}
                  detailHref={detailHref}
                  actions={
                    <MediaLogEditModal
                      mediaType={mediaType}
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
              pageHref={(p) => `${routes.profile.watched.href()}?page=${p}${typeQuery}`}
            />
          )}
        </main>
      </Document>
    )
  }
}
