import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { GenerationParams, RecommendationRunDetail } from '../../data/recommendations.ts'
import type { MediaType } from '../../data/mediaCatalog.ts'
import { routes } from '../../routes.ts'
import { Field } from '../../assets/lib/field.tsx'
import { Document } from '../../ui/components/document.tsx'
import { FloatingDropdown } from '../../ui/components/floating-dropdown.tsx'
import { StarRatingInput } from '../../ui/components/star-rating.tsx'
import { StatusSelect } from '../../ui/components/status-select.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { parseMediaMetadata } from '../../utils/mediaMetadata.ts'
import { statusLabelsFor } from '../../utils/status.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI, parseMediaType } from '../../utils/mediaTypes.ts'

const SOURCE_LABELS: Record<MediaType, string> = {
  movie: 'Movie taste',
  tv: 'TV taste',
  book: 'Book taste',
  game: 'Game taste',
}

const LENGTH_LABELS: Record<NonNullable<GenerationParams['length']>, string> = {
  short: 'Under 90 min',
  medium: '90–150 min',
  long: 'Over 150 min',
}

function describeParams(params: GenerationParams): string[] {
  const lines: string[] = [`Based on: ${params.sourceTypes.map((type) => SOURCE_LABELS[type]).join(', ')}`]
  if (params.genre) lines.push(`Genre: ${params.genre.replace(/^./, (c) => c.toUpperCase())}`)
  if (params.decade != null) lines.push(`Decade: ${params.decade}s`)
  if (params.length) lines.push(`Length: ${LENGTH_LABELS[params.length]}`)
  return lines
}

export interface RecommendationRunPageProps {
  run: RecommendationRunDetail
  displayName: string
  prunedOldestRun?: boolean
}

export function RecommendationRunPage(handle: Handle<RecommendationRunPageProps>) {
  return () => {
    const { run, displayName, prunedOldestRun } = handle.props
    const date = new Date(run.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const forLabel = ['you', ...run.otherMemberLabels].join(', ')
    const paramLines = describeParams(run.params)

    return (
      <Document title={`${run.name || `Recommendations for ${forLabel}`} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          {prunedOldestRun && (
            <p mix={css({ color: '#15803d' })}>
              You can keep up to 3 recommendation runs at a time, so your oldest one was removed.
            </p>
          )}
          <h1>{run.name || `Recommendations for ${forLabel}`}</h1>
          <p mix={css({ color: '#555' })}>
            {date}
            {run.name && ` — Recommendations for ${forLabel}`}
          </p>
          <p mix={css({ color: '#888', fontSize: '13px' })}>{paramLines.join(' · ')}</p>

          <ul
            mix={css({
              listStyle: 'none',
              margin: '24px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            })}
          >
            {run.results.map(({ item, tags, reason, interaction }) => {
              const { releaseYear, posterUrl } = parseMediaMetadata(item.metadata)
              const itemType = parseMediaType(item.type) ?? DEFAULT_MEDIA_TYPE
              const itemUi = MEDIA_TYPE_UI[itemType]
              // Where a log submitted from this row comes back to, and what
              // the detail link offers as a way back.
              const runHref = routes.recommendations.show.href({ runId: String(run.id) })
              const detailHref = `${itemUi.hrefs.show(item.id)}?from=${encodeURIComponent(runHref)}`

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
                  <div mix={css({ flex: '1 1 auto', minWidth: 0 })}>
                    <a href={detailHref} mix={css({ fontWeight: 700 })}>
                      {item.title}
                    </a>
                    {releaseYear ? ` (${releaseYear})` : ''}
                    {interaction && (
                      <span
                        mix={css({
                          display: 'inline-block',
                          marginLeft: '8px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontSize: '11px',
                          border: '1px solid #15803d',
                          color: '#15803d',
                        })}
                      >
                        {statusLabelsFor(itemType)[interaction.status] ?? interaction.status}
                      </span>
                    )}
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
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: '#555' })}>{reason}</p>
                  </div>
                  {/* Right-hand column, so the control lines up down the list
                      regardless of how long each title and reason runs. The
                      panel hangs from the right edge because at this position
                      a left-anchored one would open off the page. */}
                  <div mix={css({ flex: '0 0 auto', alignSelf: 'flex-start' })}>
                    <FloatingDropdown triggerLabel={interaction ? 'Edit' : 'Log'} align="right">
                      <form
                        method="post"
                        action={itemUi.hrefs.log(item.id)}
                        mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
                      >
                        <input type="hidden" name="return_to" value={runHref} />
                        <Field label={`Add to ${itemUi.singular} list`}>
                          <StatusSelect
                            mediaType={itemType}
                            name="status"
                            defaultValue={interaction?.status ?? 'want_to_consume'}
                          />
                        </Field>
                        {/* Pre-filled from the existing log: the action writes
                            whatever is submitted, so leaving these out would
                            null a rating or note already there. */}
                        <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '10px' })}>
                          <div>
                            <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                            <StarRatingInput
                              name="rating"
                              idPrefix={`rec-rating-${item.id}`}
                              defaultValue={interaction?.rating ?? null}
                            />
                          </div>
                          <Field label="Add thoughts">
                            <input
                              type="text"
                              name="notes"
                              defaultValue={interaction?.notes ?? ''}
                              placeholder="What did you think?"
                            />
                          </Field>
                        </div>
                        <button type="submit">Save</button>
                      </form>
                    </FloatingDropdown>
                  </div>
                </li>
              )
            })}
          </ul>
        </main>
      </Document>
    )
  }
}
