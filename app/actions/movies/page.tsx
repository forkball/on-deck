import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { getUserInteractionForItem, MovieResult } from '../../data/movies.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { FloatingDropdown } from '../../ui/floating-dropdown.tsx'
import { Nav } from '../../ui/nav.tsx'
import { StarRatingDisplay, StarRatingInput } from '../../ui/star-rating.tsx'
import { StatusSelect } from '../../ui/status-select.tsx'
import { stackedLabel } from '../../ui/styles.ts'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { STATUS_LABELS } from '../../utils/status.ts'

export interface MoviesSearchPageProps {
  query: string
  genre: string
  results: MovieResult[]
  availableTags: string[]
  interactionsByItemId: Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>
  message?: string
}

function capitalize(tag: string): string {
  return tag.replace(/^./, (c) => c.toUpperCase())
}

function TagPill(handle: Handle<{ label: string; href: string; active: boolean }>) {
  return () => {
    const { label, href, active } = handle.props
    return (
      <a
        href={href}
        mix={css({
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: '999px',
          border: '1px solid #3c3c3c',
          fontSize: '13px',
          textDecoration: 'none',
          color: active ? '#fff' : '#3c3c3c',
          backgroundColor: active ? '#3c3c3c' : 'transparent',
        })}
      >
        {label}
      </a>
    )
  }
}

export function MoviesSearchPage(handle: Handle<MoviesSearchPageProps>) {
  return () => {
    const { query, genre, results, availableTags, interactionsByItemId, message } = handle.props
    const returnTo = genre
      ? `${routes.movies.search.href()}?genre=${encodeURIComponent(genre)}`
      : `${routes.movies.search.href()}?q=${encodeURIComponent(query)}`

    return (
      <Document title="Search movies | On Deck">
        <Nav authed={true} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Search movies</h1>
          {message && <p mix={css({ color: '#15803d' })}>{message}</p>}
          <form
            method="get"
            action={routes.movies.search.href()}
            mix={css({ display: 'flex', gap: '8px', marginBottom: '16px' })}
          >
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search TMDB for a movie…"
              mix={css({ flex: '1 1 auto', minWidth: 0 })}
            />
            <button type="submit">Search</button>
          </form>

          {availableTags.length > 0 && (
            <section mix={css({ marginBottom: '24px' })}>
              <p mix={css({ margin: '0 0 8px', fontSize: '13px', color: '#555' })}>
                Genres in your catalog so far — click one to browse movies you've already imported:
              </p>
              <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '8px' })}>
                <TagPill label="All" href={routes.movies.search.href()} active={!genre} />
                {availableTags.map((tag) => (
                  <TagPill
                    key={tag}
                    label={capitalize(tag)}
                    href={`${routes.movies.search.href()}?genre=${encodeURIComponent(tag)}`}
                    active={genre === tag}
                  />
                ))}
              </div>
            </section>
          )}

          {results.length > 0 && (
            <section>
              <h2>{genre ? `Tagged "${capitalize(genre)}"` : 'Results'}</h2>
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                {results.map(({ item, tags }) => {
                  const { releaseYear, posterUrl } = parseMovieMetadata(item.metadata)
                  const detailHref = `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(returnTo)}`
                  const interaction = interactionsByItemId.get(item.id)
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
                        {tags.length > 0 && (
                          <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' })}>
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                mix={css({
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  border: '1px solid #ccc',
                                  color: '#555',
                                })}
                              >
                                {capitalize(tag)}
                              </span>
                            ))}
                          </div>
                        )}
                        {interaction && (
                          <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 0', fontSize: '13px', color: '#555' })}>
                            {STATUS_LABELS[interaction.status] ?? interaction.status}
                            {interaction.rating != null && (
                              <>
                                <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
                              </>
                            )}
                          </p>
                        )}

                        <div mix={css({ marginTop: '8px' })}>
                          <FloatingDropdown triggerLabel={interaction ? 'Edit' : '+ Add to list'}>
                            <form
                              method="post"
                              action={routes.movies.log.href({ mediaItemId: String(item.id) })}
                              mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
                            >
                              <input type="hidden" name="return_to" value={returnTo} />
                              <label mix={stackedLabel}>
                                Add to watch list
                                <StatusSelect name="status" defaultValue={interaction?.status ?? 'want_to_consume'} />
                              </label>
                              <div>
                                <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                                <StarRatingInput
                                  name="rating"
                                  idPrefix={`rating-${item.id}`}
                                  defaultValue={interaction?.rating ?? null}
                                />
                              </div>
                              <label mix={stackedLabel}>
                                Add thoughts
                                <input
                                  type="text"
                                  name="notes"
                                  defaultValue={interaction?.notes ?? ''}
                                  placeholder="What did you think?"
                                />
                              </label>
                              <button type="submit">Save</button>
                            </form>
                          </FloatingDropdown>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <p mix={css({ marginTop: '32px' })}>
            <a href={routes.profile.index.href()}>See everything you've watched and edit your ratings</a> on
            your profile page.
          </p>
        </main>
      </Document>
    )
  }
}
