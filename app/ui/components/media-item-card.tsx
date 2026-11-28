import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaItem, UserMediaInteraction } from '../../data/schema.ts'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { statusBadgeColor, statusLabelsFor } from '../../interactionStatus.ts'
import { FrameForm } from '../../browser/frame-form.tsx'
import { FloatingDropdown } from './floating-dropdown.tsx'
import { PencilIcon, PlusIcon } from './log-icons.tsx'
import { NotesField } from './notes-field.tsx'
import { PlatformList, chipStyle } from './platform-list.tsx'
import { DislikedDisplay, StarIcon, StarRatingInput } from './star-rating.tsx'
import { StatusSelect } from './status-select.tsx'
import { Field } from '../shared/field.tsx'
import { Button, Link } from '../shared/form-controls.tsx'
import { withReturnTo } from '../backLink.ts'

// The frame every card in a result list shares, marked down its left edge in the
// media type's colour.
function cardFrame(hue: string) {
  return css({
    border: '1px solid var(--rule)',
    borderLeft: `4px solid ${hue}`,
    borderRadius: '8px',
    padding: '16px',
  })
}

const COVER_WIDTH = '60px'

// A card's cover, or an empty frame of the same size when the catalog has none,
// so the text beside it lines up either way. A link to the detail page when given
// one.
function CardCover(handle: Handle<{ src: string | null; alt: string; href?: string; lazy?: boolean }>) {
  return () => {
    const { src, alt, href, lazy } = handle.props
    const place = css({ flex: '0 0 auto', alignSelf: 'flex-start' })
    if (!src) {
      return (
        <div
          mix={[
            place,
            css({ width: COVER_WIDTH, height: '90px', border: '1px solid var(--rule)', borderRadius: '4px' }),
          ]}
        />
      )
    }
    const img = (
      <img
        src={src}
        alt={alt}
        loading={lazy ? 'lazy' : undefined}
        mix={[css({ width: COVER_WIDTH, borderRadius: '4px', display: 'block' }), ...(href ? [] : [place])]}
      />
    )
    return href ? (
      <Link variant="wrap" href={href} mix={place}>
        {img}
      </Link>
    ) : (
      img
    )
  }
}

function capitalize(tag: string): string {
  return tag.replace(/^./, (c) => c.toUpperCase())
}

// One catalog entry as a row in a list — a search result, a recommendation — so
// the two read as the same thing: cover, title and year with the log control
// beside them, then whatever the page has to say about it, then its tags. The
// page supplies that text (`children`): the model's reason on a run, the
// catalog's blurb in search.
//
// Renders the <li> itself; the caller owns the <ul> and its spacing.
export function MediaItemCard(
  handle: Handle<{
    item: MediaItem
    mediaType: ActiveMediaType
    interaction: UserMediaInteraction | null | undefined
    // Where a log submitted from the card comes back to, and what the detail
    // link offers as a way back.
    returnTo: string
    children?: RemixNode
    // For a long list whose lower rows start hidden.
    lazyImage?: boolean
    // Full width under the whole card, cover column included — for something
    // too wide for the text column, such as the issues a collected edition
    // gathers.
    footer?: RemixNode
  }>,
) {
  return () => {
    const { item, mediaType, interaction, returnTo, children, lazyImage, footer } = handle.props
    const { releaseYear, posterUrl, creator, tags, platforms } = parseMediaMetadata(item.metadata)
    const ui = MEDIA_TYPE_UI[mediaType]
    const detailHref = withReturnTo(ui.hrefs.show(item.id), returnTo)
    const byline = [creator, releaseYear].filter(Boolean).join(' · ')
    // A rating or "Not for me" already says it was finished, so "Read" beside
    // it repeats itself. Only for a finished row: a rating survives a later
    // change of status (a re-read), and there the status is the news.
    const showStatus =
      interaction != null &&
      !(interaction.status === 'consumed' && (interaction.rating != null || interaction.disliked))

    // Your log: stars, the status pill, "Not for me". Rendered twice — on the
    // byline for a narrow screen, and beside the title on a wide one — with
    // .card-log in app.css showing one or the other.
    const log =
      interaction != null ? (
        <>
          {/* One star and the number, in a pill like the status beside it:
              five loose stars at this size floated off the title. Number()
              because the column is a decimal, which reads back as "4.0". */}
          {interaction.rating != null && (
            <span
              mix={[chipStyle, css({ display: 'inline-flex', alignItems: 'center', gap: '4px' })]}
              role="img"
              aria-label={`Rated ${Number(interaction.rating)} out of 5`}
            >
              <StarIcon variant="filled" size={12} />
              {Number(interaction.rating)}
            </span>
          )}
          {showStatus && (
            <span
              mix={[
                chipStyle,
                css({
                  borderColor: statusBadgeColor(interaction.status),
                  color: statusBadgeColor(interaction.status),
                }),
              ]}
            >
              {statusLabelsFor(mediaType)[interaction.status] ?? interaction.status}
            </span>
          )}
          {/* A chip, so beside the byline it reads as your verdict
              rather than as more of the author's name. */}
          {interaction.disliked && (
            <span mix={chipStyle}>
              <DislikedDisplay />
            </span>
          )}
        </>
      ) : null

    return (
      <li
        mix={[
          cardFrame(ui.hue),
          // Only a footer wraps: it alone asks for the whole row.
          css({ display: 'flex', flexWrap: 'wrap', gap: '12px' }),
        ]}
      >
        <CardCover src={posterUrl} alt={`${item.title} poster`} href={detailHref} lazy={lazyImage} />
        <div mix={css({ flex: '1 1 0', minWidth: 0 })}>
          <div mix={css({ display: 'flex', gap: '12px' })}>
            <div mix={css({ flex: '1 1 0', minWidth: 0 })}>
              <Link href={detailHref}>{item.title}</Link>
              {log && <span class="card-log card-log--wide">{log}</span>}
              {/* The byline: author and year, one line under the title, so the
                  title line is the title and your log. Searching "Strata"
                  returns one from 1981 and one from 2011, and without these the
                  two were the same row to read. Films and TV only have an
                  author once a detail lookup has run, so a pick nobody has
                  opened can go without. On a narrow screen your log follows
                  here instead of beside the title, which rarely leaves room. */}
              {(byline || log) && (
                <div
                  mix={css({
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: 'var(--soft)',
                    marginTop: '2px',
                  })}
                >
                  {byline && <span>{byline}</span>}
                  {log && <span class="card-log card-log--narrow">{log}</span>}
                </div>
              )}
            </div>
            {/* Beside the title rather than in a column of its own, so the text
                underneath runs the full width under both. The panel hangs from
                the right edge because at this position a left-anchored one
                would open off the page. */}
            <div mix={css({ flex: '0 0 auto', alignSelf: 'flex-start' })}>
              <FloatingDropdown
                triggerLabel={interaction ? 'Edit log' : 'Log'}
                icon={interaction ? <PencilIcon /> : <PlusIcon />}
                align="right"
              >
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
                  {/* Pre-filled from the existing log: the action writes
                      whatever is submitted, so leaving these out would null a
                      rating or note already there. */}
                  <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '10px' })}>
                    <div>
                      <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                      <StarRatingInput
                        name="rating"
                        idPrefix={`log-rating-${item.id}`}
                        defaultValue={interaction?.rating ?? null}
                        disliked={interaction?.disliked ?? null}
                      />
                    </div>
                    <NotesField defaultValue={interaction?.notes} />
                  </div>
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                  <FrameForm />
                </form>
              </FloatingDropdown>
            </div>
          </div>
          {children}
          {tags.length > 0 && (
            <div
              mix={css({
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '4px',
                marginTop: '8px',
                fontSize: '13px',
                color: 'var(--soft)',
              })}
            >
              {tags.map((tag) => (
                <span key={tag} mix={chipStyle}>
                  {capitalize(tag)}
                </span>
              ))}
            </div>
          )}
          {/* Empty for everything but games, so no other type renders a gap here. */}
          <PlatformList platforms={platforms} />
        </div>
        {footer && <div mix={css({ flexBasis: '100%', minWidth: 0 })}>{footer}</div>}
      </li>
    )
  }
}
