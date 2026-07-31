import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { GenerationParams, RecommendationRunDetail } from '../../data/recommendations.ts'
import type { MediaType } from '../../data/mediaCatalog.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { STATUS_LABELS } from '../../utils/status.ts'

const SOURCE_LABELS: Record<MediaType, string> = {
  movie: 'Movie taste',
  tv: 'TV taste',
  book: 'Book taste',
  comic: 'Comic taste',
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
            {run.results.map(({ item, tags, reason, status }) => {
              const { releaseYear, posterUrl } = parseMovieMetadata(item.metadata)
              const showRoute = item.type === 'tv' ? routes.tv.show : routes.movies.show
              const detailHref = `${showRoute.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(routes.recommendations.show.href({ runId: String(run.id) }))}`

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
                  <div mix={css({ flex: '1 1 auto' })}>
                    <a href={detailHref} mix={css({ fontWeight: 700 })}>
                      {item.title}
                    </a>
                    {releaseYear ? ` (${releaseYear})` : ''}
                    {status && (
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
                        {STATUS_LABELS[status] ?? status}
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
                </li>
              )
            })}
          </ul>
        </main>
      </Document>
    )
  }
}
