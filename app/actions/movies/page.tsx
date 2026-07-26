import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMovieLog } from '../../data/movies.ts'
import type { MediaItem } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Nav } from '../../ui/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { formatStars, RATING_OPTIONS } from '../../utils/stars.ts'

export interface MoviesSearchPageProps {
  query: string
  results: MediaItem[]
  log: Awaited<ReturnType<typeof listUserMovieLog>>
  message?: string
}

export function MoviesSearchPage(handle: Handle<MoviesSearchPageProps>) {
  return () => {
    const { query, results, log, message } = handle.props
    const returnTo = `${routes.movies.search.href()}?q=${encodeURIComponent(query)}`

    return (
      <Document title="Search movies | On Deck">
        <Nav authed={true} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Search movies</h1>
          {message && <p mix={css({ color: '#15803d' })}>{message}</p>}
          <form
            method="get"
            action={routes.movies.search.href()}
            mix={css({ display: 'flex', gap: '8px', marginBottom: '24px' })}
          >
            <input type="text" name="q" defaultValue={query} placeholder="Search TMDB for a movie…" />
            <button type="submit">Search</button>
          </form>

          {results.length > 0 && (
            <section>
              <h2>Results</h2>
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                {results.map((item) => {
                  const { releaseYear, posterUrl } = parseMovieMetadata(item.metadata)
                  const detailHref = routes.movies.show.href({ mediaItemId: String(item.id) })
                  return (
                    <li
                      key={item.id}
                      mix={css({
                        display: 'flex',
                        gap: '12px',
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        padding: '16px',
                      })}
                    >
                      {posterUrl ? (
                        <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
                          <img src={posterUrl} alt={`${item.title} poster`} mix={css({ width: '60px', borderRadius: '4px', display: 'block' })} />
                        </a>
                      ) : (
                        <div
                          mix={css({
                            width: '60px',
                            height: '90px',
                            flex: '0 0 auto',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                          })}
                        />
                      )}
                      <div mix={css({ flex: '1 1 auto' })}>
                        <a href={detailHref} mix={css({ fontWeight: 700 })}>
                          {item.title}
                        </a>
                        {releaseYear ? ` (${releaseYear})` : ''}
                        <form
                          method="post"
                          action={routes.movies.log.href({ mediaItemId: String(item.id) })}
                          mix={css({ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' })}
                        >
                          <input type="hidden" name="return_to" value={returnTo} />
                          <select name="status">
                            <option value="want_to_consume">Want to watch</option>
                            <option value="in_progress">Watching</option>
                            <option value="consumed">Watched</option>
                            <option value="dropped">Dropped</option>
                          </select>
                          <select name="rating" defaultValue="">
                            <option value="">No rating</option>
                            {RATING_OPTIONS.map((v) => (
                              <option key={v} value={v}>
                                {formatStars(v)} {v}
                              </option>
                            ))}
                          </select>
                          <input type="text" name="notes" placeholder="What did you think?" />
                          <button type="submit">Save</button>
                        </form>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section mix={css({ marginTop: '32px' })}>
            <h2>My movie log</h2>
            <p>
              <a href={routes.profile.index.href()}>Edit what you've watched or your ratings</a> on
              your profile page.
            </p>
            {log.length === 0 ? (
              <p>Nothing logged yet — search above and save a status for a movie.</p>
            ) : (
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' })}>
                {log.map(({ interaction, item }) => (
                  <li key={interaction.id}>
                    <a href={item ? routes.movies.show.href({ mediaItemId: String(item.id) }) : '#'}>
                      <strong>{item?.title ?? 'Unknown title'}</strong>
                    </a>{' '}
                    — {interaction.status}
                    {interaction.rating != null
                      ? ` ${formatStars(interaction.rating)} (${interaction.rating})`
                      : ''}
                    {interaction.notes ? `: "${interaction.notes}"` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </Document>
    )
  }
}
