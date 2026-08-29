import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { InteractionStatus, listUserMediaLog } from '../../data/mediaItems.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaLogEditModal } from '../../ui/components/media-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { Pagination } from '../../ui/components/pagination.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'
import { Field } from '../../ui/shared/field.tsx'
import {
  DEFAULT_MEDIA_TYPE,
  MEDIA_TYPE_UI,
  statusLabelsFor,
  statusOptionsFor,
  type ActiveMediaType,
} from '../../mediaTypes.ts'

export interface ProfileWatchedPageProps {
  movieLog: Awaited<ReturnType<typeof listUserMediaLog>>
  mediaType: ActiveMediaType
  // Which status the list is filtered to; null shows all of them.
  status: InteractionStatus | null
  page: number
  totalPages: number
  displayName: string
}

export function ProfileWatchedPage(handle: Handle<ProfileWatchedPageProps>) {
  return () => {
    const { movieLog, mediaType, status, page, totalPages, displayName } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    // Omitted for the default type, because a reader that finds no `type` falls
    // back to DEFAULT_MEDIA_TYPE — the two ends have to name the same constant.
    const typeQuery = mediaType === DEFAULT_MEDIA_TYPE ? '' : `&type=${mediaType}`
    // Everything that has to survive a page change. Kept as one string so the
    // pagination links and the "back to here" the edit modal posts can't
    // disagree about which list you were looking at.
    const filterQuery = `${typeQuery}${status ? `&status=${status}` : ''}`
    const returnTo = `${routes.profile.watched.href()}?page=${page}${filterQuery}`
    // Not "What I've watched" any more: this list includes what you've
    // declined, and the dropdown below says which slice you're on.
    const heading = `My ${ui.attributive} log`

    return (
      <Document title={`${heading} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{heading}</h1>

          {/* GET, so a filtered list is a URL you can link to or reload.
              `page` is deliberately not carried across: changing the filter
              changes how many pages there are, so it starts again at the
              first. The type is preserved, since it's which tab you came
              from rather than part of the filter. */}
          <form
            method="get"
            action={routes.profile.watched.href()}
            mix={css({ display: 'flex', alignItems: 'flex-end', gap: '8px', margin: '0 0 24px' })}
          >
            {mediaType !== DEFAULT_MEDIA_TYPE && <input type="hidden" name="type" value={mediaType} />}
            {/* Field spans its container by design, so it needs a bounded box
                of its own here or it squeezes the button off the row. */}
            <div mix={css({ flex: '0 1 200px' })}>
              <Field label="Status">
                {/* `selected` rather than defaultValue — see StatusSelect. */}
                <select name="status">
                  <option value="" selected={status === null}>
                    All
                  </option>
                  {statusOptionsFor(mediaType).map((option) => (
                    <option key={option.value} value={option.value} selected={option.value === status}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="submit">Filter</button>
          </form>

          {movieLog.length === 0 && (
            <p mix={css({ color: '#555' })}>
              Nothing in your {ui.attributive} log
              {status ? ` under "${statusLabelsFor(mediaType)[status]}"` : ''}.
            </p>
          )}

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
              pageHref={(p) => `${routes.profile.watched.href()}?page=${p}${filterQuery}`}
            />
          )}
        </main>
      </Document>
    )
  }
}
