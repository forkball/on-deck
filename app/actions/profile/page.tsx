import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Nav } from '../../ui/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { StarRatingInput } from '../../ui/star-rating.tsx'

export interface ProfilePageProps {
  summary: string
  likedTags: string[]
  dislikedTags: string[]
  movieLog: Awaited<ReturnType<typeof listUserMovieLog>>
  saved?: boolean
}

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const { summary, likedTags, dislikedTags, movieLog, saved } = handle.props

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
            <label>
              Summary
              <textarea name="summary" rows={4} defaultValue={summary} mix={css({ width: '100%' })} />
            </label>
            <label>
              Liked tags (comma-separated)
              <input type="text" name="liked_tags" defaultValue={likedTags.join(', ')} mix={css({ width: '100%' })} />
            </label>
            <label>
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
                  const detailHref = item ? routes.movies.show.href({ mediaItemId: String(item.id) }) : '#'

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
                        <form
                          method="post"
                          action={routes.movies.interactions.update.href({
                            interactionId: String(interaction.id),
                          })}
                          mix={css({ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' })}
                        >
                          <input type="hidden" name="_method" value="PUT" />
                          <input type="hidden" name="return_to" value={`${routes.profile.index.href()}?saved=1`} />
                          <select name="status" defaultValue={interaction.status}>
                            <option value="want_to_consume">Want to watch</option>
                            <option value="in_progress">Watching</option>
                            <option value="consumed">Watched</option>
                            <option value="dropped">Dropped</option>
                          </select>
                          <StarRatingInput
                            name="rating"
                            idPrefix={`rating-${interaction.id}`}
                            defaultValue={interaction.rating ?? null}
                          />
                          <input
                            type="text"
                            name="notes"
                            defaultValue={interaction.notes ?? ''}
                            placeholder="What did you think?"
                            mix={css({ flex: '1 1 200px' })}
                          />
                          <button type="submit">Save</button>
                        </form>
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
