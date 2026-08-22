import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { DEFAULT_MEDIA_TYPE, parseMediaType, statusLabelsFor } from '../../mediaTypes.ts'
import { PlatformList } from './platform-list.tsx'
import { DislikedDisplay, StarRatingDisplay } from './star-rating.tsx'

export interface WatchedListItemProps {
  interaction: UserMediaInteraction
  item: MediaItem | null
  detailHref: string
  actions?: RemixNode
  // Replaces the status line for a log someone else wrote, where whose it is
  // matters as much as what it says — the home page's feed reads
  // "mona watched". The status is still in it; it just isn't the whole line.
  byline?: RemixNode
  // "Logged 12 Aug" is what your own log says. A feed of other people's is
  // already a list of things that were logged, so it just dates them.
  dateLabel?: string
}

export function WatchedListItem(handle: Handle<WatchedListItemProps>) {
  return () => {
    const { interaction, item, detailHref, actions, byline, dateLabel = 'Logged' } = handle.props
    const { posterUrl, platforms } = item
      ? parseMediaMetadata(item.metadata)
      : { posterUrl: null, platforms: [] }
    // Derived from the row's own item rather than threaded in: a logged
    // book must read "Read", not "Watched".
    const statusLabels = statusLabelsFor(parseMediaType(item?.type) ?? DEFAULT_MEDIA_TYPE)
    const loggedDate = new Date(interaction.updated_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

    return (
      <li
        mix={css({
          display: 'flex',
          gap: '12px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '12px 16px',
        })}
      >
        {posterUrl ? (
          <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
            <img
              src={posterUrl}
              alt={`${item?.title ?? ''} poster`}
              mix={css({ width: '48px', borderRadius: '4px', display: 'block' })}
            />
          </a>
        ) : (
          <div
            mix={css({
              width: '48px',
              height: '72px',
              flex: '0 0 auto',
              border: '1px solid #ddd',
              borderRadius: '4px',
            })}
          />
        )}
        <div
          mix={css({
            flex: '1 1 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
          })}
        >
          <div>
            <a href={detailHref}>
              <strong>{item?.title ?? 'Unknown title'}</strong>
            </a>
            {byline ?? (
              <p mix={css({ margin: '4px 0 0' })}>
                {statusLabels[interaction.status] ?? interaction.status}
              </p>
            )}
            {/* Games only in practice — every other type carries no platforms,
                and the list renders nothing for an empty one. */}
            <PlatformList platforms={platforms} />
            {interaction.rating != null && (
              <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 0' })}>
                <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
              </p>
            )}
            {interaction.disliked && (
              <p mix={css({ margin: '4px 0 0' })}>
                <DislikedDisplay />
              </p>
            )}
            {interaction.notes && (
              <p mix={css({ margin: '4px 0 0', fontStyle: 'italic' })}>"{interaction.notes}"</p>
            )}
            <p mix={css({ margin: '4px 0 0', fontSize: '12px', color: '#888' })}>
              {dateLabel ? `${dateLabel} ${loggedDate}` : loggedDate}
            </p>
          </div>

          {actions}
        </div>
      </li>
    )
  }
}
