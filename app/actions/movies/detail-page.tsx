import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Nav } from '../../ui/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { formatStars, RATING_OPTIONS } from '../../utils/stars.ts'

export interface MovieDetailPageProps {
  item: MediaItem
  tags: string[]
  interaction: UserMediaInteraction | null
}

export function MovieDetailPage(handle: Handle<MovieDetailPageProps>) {
  return () => {
    const { item, tags, interaction } = handle.props
    const { releaseYear, posterUrl } = parseMovieMetadata(item.metadata)

    return (
      <Document title={`${item.title} | On Deck`}>
        <Nav authed={true} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <p>
            <a href={routes.movies.search.href()}>← Back to search</a>
          </p>
          <div mix={css({ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' })}>
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={`${item.title} poster`}
                mix={css({ width: '220px', borderRadius: '8px', flex: '0 0 auto' })}
              />
            ) : (
              <div
                mix={css({
                  width: '220px',
                  height: '330px',
                  flex: '0 0 auto',
                  borderRadius: '8px',
                  border: '1px solid #ddd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#888',
                  textAlign: 'center',
                  padding: '16px',
                })}
              >
                No poster available
              </div>
            )}
            <div mix={css({ flex: '1 1 320px' })}>
              <h1 mix={css({ marginTop: 0 })}>
                {item.title}
                {releaseYear ? ` (${releaseYear})` : ''}
              </h1>
              {tags.length > 0 && (
                <p mix={css({ color: '#555' })}>{tags.map((t) => t.replace(/^./, (c) => c.toUpperCase())).join(', ')}</p>
              )}

              <form
                method="post"
                action={
                  interaction
                    ? routes.movies.interactions.update.href({ interactionId: String(interaction.id) })
                    : routes.movies.log.href({ mediaItemId: String(item.id) })
                }
                mix={css({ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' })}
              >
                {interaction && <input type="hidden" name="_method" value="PUT" />}
                <input
                  type="hidden"
                  name="return_to"
                  value={routes.movies.show.href({ mediaItemId: String(item.id) })}
                />
                <label>
                  Status
                  <select name="status" defaultValue={interaction?.status ?? 'want_to_consume'}>
                    <option value="want_to_consume">Want to watch</option>
                    <option value="in_progress">Watching</option>
                    <option value="consumed">Watched</option>
                    <option value="dropped">Dropped</option>
                  </select>
                </label>
                <label>
                  Rating
                  <select name="rating" defaultValue={interaction?.rating ?? ''}>
                    <option value="">No rating</option>
                    {RATING_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {formatStars(v)} {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    rows={3}
                    defaultValue={interaction?.notes ?? ''}
                    placeholder="What did you think?"
                    mix={css({ width: '100%' })}
                  />
                </label>
                <button type="submit">{interaction ? 'Update' : 'Save'}</button>
              </form>
            </div>
          </div>
        </main>
      </Document>
    )
  }
}
