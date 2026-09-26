import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { statusLabelsFor } from '../../interactionStatus.ts'
import { routes } from '../../routes.ts'
import { FrameForm } from '../../browser/frame-form.tsx'
import { Document } from '../components/document.tsx'
import { ExpandableText } from '../components/expandable-text.tsx'
import { ImageCarousel } from '../components/image-carousel.tsx'
import { Modal } from '../components/modal.tsx'
import { Nav } from '../components/nav.tsx'
import { NotesField } from '../components/notes-field.tsx'
import { PlatformList } from '../components/platform-list.tsx'
import { StatusSelect } from '../components/status-select.tsx'
import { Collapsible } from '../shared/collapsible.tsx'
import { Field } from '../shared/field.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { stripPublisherPromo } from '../../data/catalog/blurb.ts'
import { catalogPageFor } from '../../data/catalog/links.ts'
import { DislikedDisplay, StarRatingDisplay, StarRatingInput } from '../components/star-rating.tsx'
import { backLinkFrom, withReturnTo } from '../backLink.ts'

export interface MediaDetailPageProps {
  mediaType: ActiveMediaType
  item: MediaItem
  interaction: UserMediaInteraction | null
  from?: string
  displayName: string
  // Repointing a media_items row changes it for everyone who logged that work,
  // so the form is only offered to admins — see the rematch action in
  // actions/media-actions.tsx, which enforces it.
  canRematch?: boolean
  rematchError?: string
  rematched?: boolean
  merged?: boolean
}

// Shared by every media type's detail route. Everything type-specific comes
// from MEDIA_TYPE_UI.
export function MediaDetailPage(handle: Handle<MediaDetailPageProps>) {
  return () => {
    const { mediaType, item, interaction, from, displayName, canRematch, rematchError, rematched, merged } =
      handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const {
      releaseYear,
      posterUrl,
      overview,
      creator,
      creators,
      cast,
      tagline,
      runtimeMinutes,
      images,
      platforms,
      tags,
    } = parseMediaMetadata(item.metadata)
    // Only a movie's is the length of the thing itself — a show's is one episode.
    const runtime = mediaType === 'movie' ? formatRuntime(runtimeMinutes) : null
    const genres = tags.map((t) => t.replace(/^./, (c) => c.toUpperCase())).join(', ')
    // A medium with stills shows them instead of a poster, having none to show:
    // 16:9 key art in a 220px portrait slot renders as a letterbox, and the
    // first still is that same art, so nothing is lost by dropping the slot.
    const showStills = images.length > 0
    const catalogPage = catalogPageFor(item)
    const showHref = ui.hrefs.show(item.id)
    const returnTo = from ? withReturnTo(showHref, from) : showHref
    const backLink = backLinkFrom(from)

    return (
      <Document title={`${item.title} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          {backLink && (
            <p mix={css({ margin: '0 0 16px' })}>
              <a href={backLink.href}>{backLink.label}</a>
            </p>
          )}
          {rematched && (
            <p mix={css({ color: '#2a7' })}>
              {merged
                ? `Merged into the existing correct entry for this ${ui.itemNoun} — logs from everyone who had it under the wrong entry now live here too.`
                : `Updated to match the correct ${ui.itemNoun} on ${ui.catalogName}.`}
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
              {tagline && (
                <p mix={css({ margin: '-8px 0 12px', color: '#555', fontStyle: 'italic' })}>{tagline}</p>
              )}
              {creator && (
                <p mix={css({ margin: '0 0 8px', color: '#555' })}>
                  {creators.length > 1 ? `${ui.creditLabel}s` : ui.creditLabel}: <strong>{creator}</strong>
                </p>
              )}
              {(genres || runtime) && (
                <p mix={css({ color: '#555' })}>{[genres, runtime].filter(Boolean).join(' · ')}</p>
              )}
              <PlatformList platforms={platforms} />
              {overview ? (
                <ExpandableText
                  // Rows stored before the providers stripped jacket copy still
                  // carry it; stripping is idempotent, so doing it again on
                  // cleaned text changes nothing.
                  text={mediaType === 'book' ? stripPublisherPromo(overview) : overview}
                  id={`overview-${item.id}`}
                />
              ) : (
                <p>No description available.</p>
              )}
              {cast.length > 0 && (
                <section mix={css({ marginTop: '16px' })}>
                  <h2 mix={css({ fontSize: '16px', margin: '0 0 6px' })}>Cast</h2>
                  <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, color: '#555' })}>
                    {cast.map((member) => (
                      // Block, so DoodleCSS's "* " marker has nowhere to go —
                      // see run-list.tsx.
                      <li mix={css({ display: 'block', margin: '0 0 2px' })}>
                        <strong mix={css({ color: '#333' })}>{member.name}</strong>
                        {member.character ? ` as ${member.character}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {catalogPage && (
                <p mix={css({ margin: '12px 0 0', fontSize: '14px' })}>
                  <a href={catalogPage.url} target="_blank" rel="noopener noreferrer">
                    View on {catalogPage.name}
                  </a>
                </p>
              )}

              {/* Top margin matters now that the description above may end
                  in a Read more toggle, which carries no bottom margin of
                  its own — without this the two sit flush together. */}
              {canRematch && (
                <div mix={css({ marginTop: '20px', marginBottom: '16px', color: '#555' })}>
                  {/* Held open when the last attempt failed: collapsing would hide
                      both the error and the field it refers to, leaving the page
                      looking like nothing happened. */}
                  <Collapsible summary={`Wrong ${ui.itemNoun}?`} open={Boolean(rematchError)}>
                    <form
                      method="post"
                      action={ui.hrefs.rematch(item.id)}
                      mix={css({
                        display: 'flex',
                        gap: '8px',
                        marginTop: '8px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      })}
                    >
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input
                        type="text"
                        name="catalog_link"
                        placeholder={ui.rematchPlaceholder}
                        mix={css({ flex: '1 1 240px' })}
                      />
                      <button type="submit">Fix match</button>
                    </form>
                    <p mix={css({ margin: '8px 0 0', fontSize: '13px' })}>
                      <a
                        href={ui.catalogSearchUrl(item.title, releaseYear)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Look up "{item.title}" on {ui.catalogName}
                      </a>
                    </p>
                    <p mix={css({ margin: '8px 0 0', fontSize: '13px' })}>
                      This entry is shared: fixing the match repoints it for everyone who logged this{' '}
                      {ui.itemNoun}.
                    </p>
                    {rematchError && <p mix={css({ color: '#c33', margin: '8px 0 0' })}>{rematchError}</p>}
                  </Collapsible>
                </div>
              )}

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
                        <strong>
                          {statusLabelsFor(mediaType)[interaction.status] ?? interaction.status}
                        </strong>
                      </p>
                      {interaction.rating != null && (
                        <p
                          mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 0' })}
                        >
                          <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
                        </p>
                      )}
                      {interaction.disliked && (
                        <p mix={css({ margin: '8px 0 0' })}>
                          <DislikedDisplay />
                        </p>
                      )}
                      {interaction.notes && (
                        <p mix={css({ margin: '8px 0 0', fontStyle: 'italic' })}>"{interaction.notes}"</p>
                      )}
                    </>
                  ) : (
                    <p mix={css({ margin: 0, color: '#555' })}>You haven't logged this one yet.</p>
                  )}
                </div>

                {/* Deliberately not `fab`: the trigger belongs with the log
                    it acts on, rather than floating over unrelated content in
                    the viewport corner. The surrounding box is already
                    space-between for exactly this. */}
                <Modal
                  id={`edit-${mediaType}-${item.id}`}
                  triggerLabel={interaction ? 'Edit' : 'Log'}
                  title={item.title}
                >
                  <form
                    id={`edit-${mediaType}-form-${item.id}`}
                    method="post"
                    action={
                      interaction
                        ? routes.interactions.update.href({ interactionId: String(interaction.id) })
                        : ui.hrefs.log(item.id)
                    }
                    mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
                  >
                    {interaction && <input type="hidden" name="_method" value="PUT" />}
                    <input type="hidden" name="return_to" value={returnTo} />
                    <Field label="Status">
                      <StatusSelect
                        mediaType={mediaType}
                        name="status"
                        defaultValue={interaction?.status ?? 'want_to_consume'}
                      />
                    </Field>
                    <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '12px' })}>
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
                    <FrameForm />
                  </form>
                  {/* Delete left, save right — see media-log-edit-modal.tsx.
                      Delete only exists once something is logged, which is why
                      Save is pushed right with a margin rather than by
                      space-between: with nothing to delete it would otherwise
                      slide back to the left edge. */}
                  <div
                    mix={css({
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginTop: '12px',
                    })}
                  >
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
                        <FrameForm />
                      </form>
                    )}
                    <button
                      type="submit"
                      form={`edit-${mediaType}-form-${item.id}`}
                      mix={css({ marginLeft: 'auto' })}
                    >
                      {interaction ? 'Update' : 'Save'}
                    </button>
                  </div>
                </Modal>
              </div>
            </div>
          </div>
          {showStills && (
            <section mix={css({ marginTop: '32px' })}>
              <h2>Screenshots</h2>
              <ImageCarousel images={images} title={item.title} id={`stills-${item.id}`} />
            </section>
          )}
        </main>
      </Document>
    )
  }
}

// "2h 16m", or "45m" under an hour. Null when there is nothing to say — TMDB
// answers 0 for a film it has no runtime for, which is not a runtime.
function formatRuntime(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
