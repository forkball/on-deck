import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { statusLabelsFor } from '../../interactionStatus.ts'
import { routes } from '../../routes.ts'
import { FrameForm } from '../../browser/frame-form.tsx'
import { Page } from '../components/page.tsx'
import { PencilIcon, PlusIcon } from '../components/log-icons.tsx'
import { ExpandableText } from '../components/expandable-text.tsx'
import { ImageCarousel } from '../components/image-carousel.tsx'
import { Modal } from '../components/modal.tsx'
import { NotesField } from '../components/notes-field.tsx'
import { PlatformList } from '../components/platform-list.tsx'
import { StatusSelect } from '../components/status-select.tsx'
import { WhereToWatch, type WhereToWatchProps } from '../components/where-to-watch.tsx'
import { Collapsible } from '../shared/collapsible.tsx'
import { Field } from '../shared/field.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { stripPublisherPromo } from '../../data/catalog/blurb.ts'
import { catalogPageFor } from '../../data/catalog/links.ts'
import { DislikedDisplay, StarRatingDisplay, StarRatingInput } from '../components/star-rating.tsx'
import { backLinkFrom, withReturnTo } from '../backLink.ts'
import { Button, Link, TextInput } from '../shared/form-controls.tsx'
import { MediaTypeTag } from '../components/media-type-tag.tsx'

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
  // Movies and TV only, and only once availability has been fetched.
  watch?: Omit<WhereToWatchProps, 'title' | 'returnTo'> | null
}

// Where the page drops to one column. Matches the activity feed's.
const PHONE = '@media (max-width: 600px)'

// Shared by every media type's detail route. Everything type-specific comes
// from MEDIA_TYPE_UI.
export function MediaDetailPage(handle: Handle<MediaDetailPageProps>) {
  return () => {
    const {
      mediaType,
      item,
      interaction,
      from,
      displayName,
      canRematch,
      rematchError,
      rematched,
      merged,
      watch,
    } = handle.props
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
      pageCount,
      playtimeHours,
      series,
      seasonCount,
      episodeCount,
      lastAirYear,
      showStatus,
      networks,
      images,
      platforms,
      tags,
    } = parseMediaMetadata(item.metadata)
    // Only a movie's is the length of the thing itself — a show's is one episode.
    // How long it takes, in each medium's own unit. Only a movie's runtime is
    // the length of the thing itself — a show's is one episode — and pages and
    // time-to-beat are only ever filled for books and games.
    const length =
      (mediaType === 'movie' ? formatRuntime(runtimeMinutes) : null) ??
      countOf(pageCount, 'page') ??
      formatPlaytime(playtimeHours)
    // IGDB lists a game's collection and franchise separately, often under the
    // same name — and often the game's own, which says nothing on its own page.
    // Books never have one: Google Books has no series to give, which is why
    // recommendations ask the model instead.
    const seriesNames = [...new Set(series)].filter((name) => name.toLowerCase() !== item.title.toLowerCase())
    const genres = tags.map((t) => t.replace(/^./, (c) => c.toUpperCase())).join(', ')
    const years = yearSpan(releaseYear, lastAirYear, showStatus)
    // No type check needed: only a show's detail lookup fills any of these, so
    // every other medium comes out empty on its own.
    const showFacts = [
      countOf(seasonCount, 'season'),
      countOf(episodeCount, 'episode'),
      networks.join(', '),
      showStatus && (SHOW_STATUS_LABELS[showStatus] ?? showStatus),
    ].filter(Boolean)
    // A medium with stills shows them instead of a poster, having none to show:
    // 16:9 key art in a 220px portrait slot renders as a letterbox, and the
    // first still is that same art, so nothing is lost by dropping the slot.
    const showStills = images.length > 0
    const catalogPage = catalogPageFor(item)
    const showHref = ui.hrefs.show(item.id)
    const returnTo = from ? withReturnTo(showHref, from) : showHref
    const backLink = backLinkFrom(from)

    return (
      // No heading: the title sits beside the poster, in the layout below.
      <Page title={item.title} back={backLink} width="wide" displayName={displayName}>
        {rematched && (
          <p mix={css({ color: 'var(--success)' })}>
            {merged
              ? `Merged into the existing correct entry for this ${ui.itemNoun} — logs from everyone who had it under the wrong entry now live here too.`
              : `Updated to match the correct ${ui.itemNoun} on ${ui.catalogName}.`}
          </p>
        )}
        {/* Two columns on a wide screen: the poster with your log under it, and
              everything about the title beside them — so the log sits where you
              land, not below the cast and the streaming list. A phone has one
              column, and both wrappers step aside (display: contents) so their
              pieces can be reordered: poster, title and credits, the synopsis,
              your log, then the rest. One copy of each piece, in one DOM order,
              either way. */}
        <div
          mix={css({
            display: 'flex',
            gap: '24px',
            alignItems: 'flex-start',
            [PHONE]: { flexDirection: 'column', alignItems: 'stretch', gap: '16px' },
          })}
        >
          <div
            mix={css({
              flex: '0 0 220px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              [PHONE]: { display: 'contents' },
            })}
          >
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={`${item.title} poster`}
                mix={css({ width: '220px', borderRadius: '8px', flex: '0 0 auto', [PHONE]: { order: 1 } })}
              />
            ) : (
              <div
                mix={css({
                  width: '220px',
                  height: '330px',
                  flex: '0 0 auto',
                  borderRadius: '8px',
                  border: '1px solid var(--rule)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted)',
                  textAlign: 'center',
                  padding: '16px',
                  [PHONE]: { order: 1 },
                })}
              >
                No poster available
              </div>
            )}
            <div
              mix={css({
                border: '1px solid var(--rule)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px 16px',
                [PHONE]: { order: 4 },
              })}
            >
              <div>
                {interaction ? (
                  <>
                    <p mix={css({ margin: 0 })}>
                      <strong>{statusLabelsFor(mediaType)[interaction.status] ?? interaction.status}</strong>
                    </p>
                    {interaction.rating != null && (
                      <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 0' })}>
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
                  <p mix={css({ margin: 0, color: 'var(--soft)' })}>You haven't logged this one yet.</p>
                )}
              </div>

              {/* Deliberately not `fab`: the trigger belongs with the log
                      it acts on, rather than floating over unrelated content in
                      the viewport corner. The surrounding box is already
                      space-between for exactly this. */}
              <Modal
                id={`edit-${mediaType}-${item.id}`}
                triggerLabel={interaction ? 'Edit log' : 'Log'}
                triggerIcon={interaction ? <PencilIcon /> : <PlusIcon />}
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
                      <Button type="submit" variant="danger">
                        Delete log
                      </Button>
                      <FrameForm />
                    </form>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    form={`edit-${mediaType}-form-${item.id}`}
                    mix={css({ marginLeft: 'auto' })}
                  >
                    {interaction ? 'Update' : 'Save'}
                  </Button>
                </div>
              </Modal>
            </div>
          </div>
          <div
            mix={css({
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              [PHONE]: { display: 'contents' },
            })}
          >
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '8px', [PHONE]: { order: 2 } })}>
              <MediaTypeTag type={mediaType} />
              <h1 mix={css({ margin: '0 0 4px' })}>{item.title}</h1>
              {tagline && (
                <p mix={css({ margin: 0, color: 'var(--soft)', fontStyle: 'italic' })}>{tagline}</p>
              )}
              {creator && (
                <p mix={css({ margin: 0, color: 'var(--soft)' })}>
                  {creators.length > 1 ? ui.creditLabelPlural : ui.creditLabel}: <strong>{creator}</strong>
                </p>
              )}
              {/* The year leads the details rather than riding in the title,
                    where a show's "(2008–2013)" wrapped the heading. */}
              {(years || genres || length) && (
                <p mix={css({ margin: 0, color: 'var(--soft)' })}>
                  {[years, genres, length].filter(Boolean).join(' · ')}
                </p>
              )}
              {seriesNames.length > 0 && (
                <p mix={css({ margin: 0, color: 'var(--soft)' })}>Part of {seriesNames.join(' / ')}</p>
              )}
              {showFacts.length > 0 && (
                <p mix={css({ margin: 0, color: 'var(--soft)' })}>{showFacts.join(' · ')}</p>
              )}
              <PlatformList platforms={platforms} />
            </div>
            <div mix={css({ '& > p': { margin: 0 }, [PHONE]: { order: 3 } })}>
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
            </div>
            {/* Everything after the synopsis — on a phone, after your log.
                  Spaced by its own gap, so none of the panels in it carry an
                  outer margin: whichever comes first sits flush, in either
                  layout. */}
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '16px', [PHONE]: { order: 5 } })}>
              {cast.length > 0 && (
                // Boxed like the log box and Where to watch, so the page reads
                // as the title's details and then a few distinct panels.
                <section
                  mix={css({
                    border: '1px solid var(--rule)',
                    borderRadius: '8px',
                    padding: '12px 16px 16px',
                  })}
                >
                  <h2 mix={css({ fontSize: '16px', margin: '0 0 8px' })}>Cast</h2>
                  {/* Two aligned columns rather than "Name as Character" run
                      together: in Short Stack, a bold name and its part at the
                      same size read as one long line. The part is the lesser
                      half, so it is smaller and lighter. */}
                  <dl
                    mix={css({
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, max-content) 1fr',
                      gap: '4px 16px',
                      alignItems: 'baseline',
                      margin: 0,
                    })}
                  >
                    {cast.map((member) => (
                      <>
                        <dt mix={css({ margin: 0, color: 'var(--text)' })}>{member.name}</dt>
                        <dd mix={css({ margin: 0, color: 'var(--muted)', fontSize: '14px' })}>
                          {member.character ?? ''}
                        </dd>
                      </>
                    ))}
                  </dl>
                </section>
              )}
              {watch && <WhereToWatch {...watch} title={item.title} returnTo={returnTo} />}

              {canRematch && (
                <div mix={css({ color: 'var(--soft)' })}>
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
                      <Field
                        label={`${ui.catalogName} link`}
                        labelHidden
                        mix={css({ flex: '1 1 240px', width: 'auto' })}
                      >
                        <TextInput name="catalog_link" placeholder={ui.rematchPlaceholder} />
                      </Field>
                      <Button type="submit">Fix match</Button>
                    </form>
                    <p mix={css({ margin: '8px 0 0', fontSize: '13px' })}>
                      <Link href={ui.catalogSearchUrl(item.title, releaseYear)} external>
                        Look up "{item.title}" on {ui.catalogName}
                      </Link>
                    </p>
                    <p mix={css({ margin: '8px 0 0', fontSize: '13px' })}>
                      This entry is shared: fixing the match repoints it for everyone who logged this{' '}
                      {ui.itemNoun}.
                    </p>
                    {rematchError && (
                      <p mix={css({ color: 'var(--danger)', margin: '8px 0 0' })}>{rematchError}</p>
                    )}
                  </Collapsible>
                </div>
              )}
              {/* Last: it leaves the page, so it closes it rather than
                    sitting between the panels. */}
              {catalogPage && (
                <p mix={css({ margin: 0, fontSize: '14px' })}>
                  <Link href={catalogPage.url} external tapArea>
                    View on {catalogPage.name}
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>
        {showStills && (
          <section mix={css({ marginTop: '32px' })}>
            <h2>Screenshots</h2>
            <ImageCarousel images={images} title={item.title} id={`stills-${item.id}`} />
          </section>
        )}
      </Page>
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

// TMDB's status, said the way someone deciding whether to start a show asks it.
// Anything it adds later is shown as it comes.
const SHOW_STATUS_LABELS: Record<string, string> = {
  'Returning Series': 'Still airing',
  'In Production': 'In production',
  Ended: 'Ended',
  Canceled: 'Canceled',
  Planned: 'Announced',
  Pilot: 'Pilot',
}

// "2008–2013" for a run that is over, "2019–" for one that isn't, and the one
// year when that is all there is to say — which is every medium but TV, since
// only a show has a status. Open-ended only on TMDB's say-so: a show with no
// status and an old last air date is not "still going".
function yearSpan(first: number | null, last: number | null, status: string | null): string | null {
  if (!first) return null
  if (status === 'Returning Series' || status === 'In Production') return `${first}–`
  if ((status === 'Ended' || status === 'Canceled') && last && last > first) return `${first}–${last}`
  return String(first)
}

// IGDB's time-to-beat, which is an average: "about 52 hours", or "under an
// hour" for the rare game that short.
function formatPlaytime(hours: number | null): string | null {
  if (!hours || hours <= 0) return null
  if (hours < 1) return 'under an hour to beat'
  const rounded = Math.round(hours)
  return `about ${rounded} hour${rounded === 1 ? '' : 's'} to beat`
}

function countOf(count: number | null, noun: string): string | null {
  if (!count || count <= 0) return null
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
