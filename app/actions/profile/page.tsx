import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Modal } from '../../ui/modal.tsx'
import { Nav } from '../../ui/nav.tsx'
import { stackedLabel } from '../../ui/styles.ts'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { StarRatingDisplay, StarRatingInput } from '../../ui/star-rating.tsx'

export interface ProfilePageProps {
  summary: string
  likedTags: string[]
  dislikedTags: string[]
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  saved?: boolean
}

const STATUS_LABELS: Record<string, string> = {
  want_to_consume: 'Want to watch',
  in_progress: 'Watching',
  consumed: 'Watched',
  dropped: 'Dropped',
}

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const { summary, likedTags, dislikedTags, movieLog, saved } = handle.props
    const profileHref = routes.profile.index.href()

    return (
      <Document title="My profile | On Deck">
        <Nav authed={true} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>My taste profile</h1>
          <p mix={css({ color: '#555' })}>
            This is what drives your recommendations — edit it any time. It also updates itself
            automatically as you log what you liked or didn't about things you watch.
          </p>
          {saved && <p mix={css({ color: '#15803d' })}>Saved.</p>}
          <form
            method="post"
            action={routes.profile.update.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
          >
            <input type="hidden" name="_method" value="PUT" />
            <label mix={stackedLabel}>
              Summary
              <textarea name="summary" rows={4} defaultValue={summary} mix={css({ width: '100%' })} />
            </label>
            <label mix={stackedLabel}>
              Liked tags (comma-separated)
              <input type="text" name="liked_tags" defaultValue={likedTags.join(', ')} mix={css({ width: '100%' })} />
            </label>
            <label mix={stackedLabel}>
              Disliked tags (comma-separated)
              <input
                type="text"
                name="disliked_tags"
                defaultValue={dislikedTags.join(', ')}
                mix={css({ width: '100%' })}
              />
            </label>
            <button type="submit">Save profile</button>
          </form>

          <section mix={css({ marginTop: '40px' })}>
            <h2>What I've watched</h2>
            {movieLog.length === 0 ? (
              <p>
                Nothing logged yet — <a href={routes.movies.search.href()}>search for a movie</a> to
                get started.
              </p>
            ) : (
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                {movieLog.map(({ interaction, item }) => {
                  const { posterUrl } = item ? parseMovieMetadata(item.metadata) : { posterUrl: null }
                  const detailHref = item
                    ? `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(profileHref)}`
                    : '#'

                  return (
                    <li
                      key={interaction.id}
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
                      <div mix={css({ flex: '1 1 auto' })}>
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

                        <div mix={css({ marginTop: '8px' })}>
                          <Modal id={`edit-log-${interaction.id}`} triggerLabel="Edit">
                            <form
                              method="post"
                              action={routes.movies.interactions.update.href({
                                interactionId: String(interaction.id),
                              })}
                              mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
                            >
                              <input type="hidden" name="_method" value="PUT" />
                              <input type="hidden" name="return_to" value={`${profileHref}?saved=1`} />
                              <label mix={stackedLabel}>
                                Status
                                <select name="status" defaultValue={interaction.status}>
                                  <option value="want_to_consume">Want to watch</option>
                                  <option value="in_progress">Watching</option>
                                  <option value="consumed">Watched</option>
                                  <option value="dropped">Dropped</option>
                                </select>
                              </label>
                              <div>
                                <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                                <StarRatingInput
                                  name="rating"
                                  idPrefix={`rating-${interaction.id}`}
                                  defaultValue={interaction.rating ?? null}
                                />
                              </div>
                              <label mix={stackedLabel}>
                                Notes
                                <textarea
                                  name="notes"
                                  rows={3}
                                  defaultValue={interaction.notes ?? ''}
                                  placeholder="What did you think?"
                                  mix={css({ width: '100%' })}
                                />
                              </label>
                              <button type="submit">Save</button>
                            </form>
                          </Modal>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>
      </Document>
    )
  }
}
