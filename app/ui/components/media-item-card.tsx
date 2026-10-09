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
import { PlatformList } from './platform-list.tsx'
import { DislikedDisplay, StarRatingDisplay, StarRatingInput } from './star-rating.tsx'
import { StatusSelect } from './status-select.tsx'
import { Field } from '../shared/field.tsx'
import { Button, Link } from '../shared/form-controls.tsx'

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
    // Where the title and cover go, carrying the way back.
    detailHref: string
    // Where a log submitted from the card comes back to.
    returnTo: string
    // Under the title: the author, director or studio, where the page shows one.
    subtitle?: RemixNode
    children?: RemixNode
    // For a long list whose lower rows start hidden.
    lazyImage?: boolean
  }>,
) {
  return () => {
    const { item, mediaType, interaction, detailHref, returnTo, subtitle, children, lazyImage } = handle.props
    const { releaseYear, posterUrl, tags, platforms } = parseMediaMetadata(item.metadata)
    const ui = MEDIA_TYPE_UI[mediaType]

    return (
      <li
        mix={css({
          display: 'flex',
          gap: '12px',
          border: '1px solid var(--rule)',
          borderLeft: `4px solid ${ui.hue}`,
          borderRadius: '8px',
          padding: '16px',
        })}
      >
        {posterUrl ? (
          <Link variant="wrap" href={detailHref} mix={css({ flex: '0 0 auto', alignSelf: 'flex-start' })}>
            <img
              src={posterUrl}
              alt={`${item.title} poster`}
              loading={lazyImage ? 'lazy' : undefined}
              mix={css({ width: '60px', borderRadius: '4px', display: 'block' })}
            />
          </Link>
        ) : (
          <div
            mix={css({
              width: '60px',
              height: '90px',
              flex: '0 0 auto',
              border: '1px solid var(--rule)',
              borderRadius: '4px',
            })}
          />
        )}
        <div mix={css({ flex: '1 1 0', minWidth: 0 })}>
          <div mix={css({ display: 'flex', gap: '12px' })}>
            <div mix={css({ flex: '1 1 0', minWidth: 0 })}>
              <Link href={detailHref}>{item.title}</Link>
              {releaseYear ? ` (${releaseYear})` : ''}
              {subtitle && (
                <div mix={css({ fontSize: '13px', color: 'var(--soft)', marginTop: '2px' })}>{subtitle}</div>
              )}
              {interaction && (
                <div
                  mix={css({
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '4px',
                    fontSize: '13px',
                    color: 'var(--soft)',
                  })}
                >
                  <span
                    mix={css({
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '11px',
                      border: `1px solid ${statusBadgeColor(interaction.status)}`,
                      color: statusBadgeColor(interaction.status),
                    })}
                  >
                    {statusLabelsFor(mediaType)[interaction.status] ?? interaction.status}
                  </span>
                  {interaction.rating != null && <StarRatingDisplay value={interaction.rating} />}
                  {interaction.disliked && <DislikedDisplay />}
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
            <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' })}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  mix={css({
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    border: '1px solid var(--rule)',
                    color: 'var(--soft)',
                  })}
                >
                  {capitalize(tag)}
                </span>
              ))}
            </div>
          )}
          {/* Empty for everything but games, so no other type renders a gap here. */}
          <PlatformList platforms={platforms} />
        </div>
      </li>
    )
  }
}
