import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { STATUS_LABELS } from '../../utils/status.ts'
import { StarRatingDisplay } from './star-rating.tsx'

export interface WatchedListItemProps {
  interaction: UserMediaInteraction
  item: MediaItem | null
  detailHref: string
  actions?: RemixNode
}

export function WatchedListItem(handle: Handle<WatchedListItemProps>) {
  return () => {
    const { interaction, item, detailHref, actions } = handle.props
    const { posterUrl } = item ? parseMovieMetadata(item.metadata) : { posterUrl: null }
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
            <p mix={css({ margin: '4px 0 0' })}>{STATUS_LABELS[interaction.status] ?? interaction.status}</p>
            {interaction.rating != null && (
              <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 0' })}>
                <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
              </p>
            )}
            {interaction.notes && (
              <p mix={css({ margin: '4px 0 0', fontStyle: 'italic' })}>"{interaction.notes}"</p>
            )}
            <p mix={css({ margin: '4px 0 0', fontSize: '12px', color: '#888' })}>Logged {loggedDate}</p>
          </div>

          {actions}
        </div>
      </li>
    )
  }
}
