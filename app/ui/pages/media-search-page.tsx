import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { getUserInteractionForItem } from '../../data/mediaItems.ts'
import type { MediaItem } from '../../data/schema.ts'
import { MediaTabLinks } from '../components/media-tab-links.tsx'
import { MEDIA_TYPE_UI, statusLabelsFor, type ActiveMediaType } from '../../mediaTypes.ts'
import { FrameForm } from '../../browser/frame-form.tsx'
import { LazyList } from '../../browser/lazy-list.tsx'
import { MovieSearchForm } from '../../browser/movie-search-form.tsx'
import { Toast } from '../components/toast.tsx'
import { Document } from '../components/document.tsx'
import { FloatingDropdown } from '../components/floating-dropdown.tsx'
import { Nav } from '../components/nav.tsx'
import { NotesField } from '../components/notes-field.tsx'
import { DislikedDisplay, StarRatingDisplay, StarRatingInput } from '../components/star-rating.tsx'
import { StatusSelect } from '../components/status-select.tsx'
import { Field } from '../shared/field.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { PlatformList } from '../components/platform-list.tsx'

export interface MediaSearchPageProps {
  mediaType: ActiveMediaType
  query: string
  results: MediaItem[]
  // How many are visible before scrolling reveals the rest.
  initialVisible: number
  interactionsByItemId: Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>
  message?: string
  displayName: string
}

function capitalize(tag: string): string {
  return tag.replace(/^./, (c) => c.toUpperCase())
}

// Shared by every media type's search route. Everything that varies comes from
// MEDIA_TYPE_UI.
export function MediaSearchPage(handle: Handle<MediaSearchPageProps>) {
  return () => {
    const { mediaType, query, results, initialVisible, interactionsByItemId, message, displayName } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const returnTo = `${ui.hrefs.search()}?q=${encodeURIComponent(query)}`

    return (
      <Document title={`${ui.searchHeading} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        {message && <Toast message={message} />}
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <MediaTabLinks
            current={mediaType}
            // Switching type starts a fresh search rather than carrying the
            // query across: a title rarely means the same thing in two
            // catalogs, so carrying it just fills the new tab with noise.
            hrefFor={(type) => MEDIA_TYPE_UI[type].hrefs.search()}
          />
          <h1 mix={css({ margin: '0 0 16px' })}>{ui.searchHeading}</h1>
          <MovieSearchForm
            query={query}
            searchHref={ui.hrefs.search()}
            suggestHref={ui.hrefs.suggest()}
            importHref={ui.hrefs.import()}
            placeholder={ui.searchPlaceholder}
          />


          {results.length > 0 && (
            <section>
              <h2>
                Results{' '}
                <span mix={css({ fontSize: '14px', fontWeight: 400, color: '#888' })}>({results.length})</span>
              </h2>
              <ul
                id="search-results"
                mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}
              >
                {results.map((item) => {
                  const { releaseYear, posterUrl, platforms, tags } = parseMediaMetadata(item.metadata)
                  const detailHref = `${ui.hrefs.show(item.id)}?from=${encodeURIComponent(returnTo)}`
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
                          <img
                            src={posterUrl}
                            alt={`${item.title} poster`}
                            loading="lazy"
                            mix={css({ width: '60px', borderRadius: '4px', display: 'block' })}
                          />
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
                        <PlatformList platforms={platforms} />
                        {interaction && (
                          <p
                            mix={css({
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              margin: '4px 0 0',
                              fontSize: '13px',
                              color: '#555',
                            })}
                          >
                            {statusLabelsFor(mediaType)[interaction.status] ?? interaction.status}
                            {interaction.rating != null && (
                              <>
                                <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
                              </>
                            )}
                            {interaction.disliked && <DislikedDisplay />}
                          </p>
                        )}

                        <div mix={css({ marginTop: '8px' })}>
                          <FloatingDropdown triggerLabel={interaction ? 'Edit' : '+ Add to list'}>
                            <form
                              method="post"
                              action={ui.hrefs.log(item.id)}
                              mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
                            >
                              <input type="hidden" name="return_to" value={returnTo} />
                              <Field label={`Add to ${ui.singular} list`}>
                                <StatusSelect
                                  mediaType={mediaType}
                                  name="status"
                                  defaultValue={interaction?.status ?? 'want_to_consume'}
                                />
                              </Field>
                              <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '10px' })}>
                                <div>
                                  <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                                  <StarRatingInput
                                    name="rating"
                                    idPrefix={`rating-${item.id}`}
                                    defaultValue={interaction?.rating ?? null}
                                    disliked={interaction?.disliked ?? null}
                                  />
                                </div>
                                <NotesField defaultValue={interaction?.notes} />
                              </div>
                              <button type="submit">Save</button>
                              <FrameForm />
                            </form>
                          </FloatingDropdown>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <LazyList listId="search-results" initial={initialVisible} step={initialVisible} />
            </section>
          )}
        </main>
      </Document>
    )
  }
}
