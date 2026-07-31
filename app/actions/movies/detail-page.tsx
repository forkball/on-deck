import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Modal } from '../../ui/components/modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { StatusSelect } from '../../ui/components/status-select.tsx'
import { stackedLabel } from '../../ui/components/styles.ts'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { StarRatingDisplay, StarRatingInput } from '../../ui/components/star-rating.tsx'
import { STATUS_LABELS } from '../../utils/status.ts'

export interface MovieDetailPageProps {
  item: MediaItem
  tags: string[]
  interaction: UserMediaInteraction | null
  from?: string
  displayName: string
  rematchError?: string
  rematched?: boolean
  merged?: boolean
}

export function MovieDetailPage(handle: Handle<MovieDetailPageProps>) {
  return () => {
    const { item, tags, interaction, from, displayName, rematchError, rematched, merged } = handle.props
    const { releaseYear, posterUrl, overview } = parseMovieMetadata(item.metadata)
    const showHref = routes.movies.show.href({ mediaItemId: String(item.id) })
    const returnTo = from ? `${showHref}?from=${encodeURIComponent(from)}` : showHref

    return (
      <Document title={`${item.title} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          {rematched && (
            <p mix={css({ color: '#2a7' })}>
              {merged
                ? 'Merged into the existing correct entry for this movie — logs from everyone who had it under the wrong entry now live here too.'
                : 'Updated to match the correct movie on TMDB.'}
            </p>
          )}
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
              <p>{overview ?? 'No description available.'}</p>

              <details mix={css({ marginBottom: '16px', color: '#555' })}>
                <summary mix={css({ cursor: 'pointer' })}>Wrong movie?</summary>
                <form
                  method="post"
                  action={routes.movies.rematch.href({ mediaItemId: String(item.id) })}
                  mix={css({ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' })}
                >
                  <input type="hidden" name="return_to" value={returnTo} />
                  <input
                    type="text"
                    name="tmdb_link"
                    placeholder="Paste a themoviedb.org link or id"
                    mix={css({ flex: '1 1 240px' })}
                  />
                  <button type="submit">Fix match</button>
                </form>
                {rematchError && <p mix={css({ color: '#c33', margin: '8px 0 0' })}>{rematchError}</p>}
              </details>

              <div
                mix={css({
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '16px',
                  marginTop: '24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '16px',
                })}
              >
                <div>
                  {interaction ? (
                    <>
                      <p mix={css({ margin: 0 })}>
                        <strong>{STATUS_LABELS[interaction.status] ?? interaction.status}</strong>
                      </p>
                      {interaction.rating != null && (
                        <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 0' })}>
                          <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
                        </p>
                      )}
                      {interaction.notes && <p mix={css({ margin: '8px 0 0', fontStyle: 'italic' })}>"{interaction.notes}"</p>}
                    </>
                  ) : (
                    <p mix={css({ margin: 0, color: '#555' })}>You haven't logged this one yet.</p>
                  )}
                </div>

                <Modal
                  id={`edit-movie-${item.id}`}
                  triggerLabel={interaction ? 'Edit' : 'Log this movie'}
                  title={item.title}
                  fab
                >
                  <form
                    id={`edit-movie-form-${item.id}`}
                    method="post"
                    action={
                      interaction
                        ? routes.interactions.update.href({ interactionId: String(interaction.id) })
                        : routes.movies.log.href({ mediaItemId: String(item.id) })
                    }
                    mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
                  >
                    {interaction && <input type="hidden" name="_method" value="PUT" />}
                    <input type="hidden" name="return_to" value={returnTo} />
                    <label mix={stackedLabel}>
                      Status
                      <StatusSelect name="status" defaultValue={interaction?.status ?? 'want_to_consume'} />
                    </label>
                    <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '12px' })}>
                      <div>
                        <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                        <StarRatingInput
                          name="rating"
                          idPrefix={`rating-${item.id}`}
                          defaultValue={interaction?.rating ?? null}
                        />
                      </div>
                      <label mix={stackedLabel}>
                        Notes
                        <textarea
                          name="notes"
                          rows={3}
                          defaultValue={interaction?.notes ?? ''}
                          placeholder="What did you think?"
                          mix={css({ width: '100%' })}
                        />
                      </label>
                    </div>
                  </form>
                  <div
                    mix={css({
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      marginTop: '12px',
                    })}
                  >
                    <button type="submit" form={`edit-movie-form-${item.id}`}>
                      {interaction ? 'Update' : 'Save'}
                    </button>
                    {interaction && (
                      <form
                        method="post"
                        action={routes.interactions.destroy.href({ interactionId: String(interaction.id) })}
                      >
                        <input type="hidden" name="_method" value="DELETE" />
                        <input type="hidden" name="return_to" value={returnTo} />
                        <button type="submit" class="danger">
                          Delete log
                        </button>
                      </form>
                    )}
                  </div>
                </Modal>
              </div>
            </div>
          </div>
        </main>
      </Document>
    )
  }
}
