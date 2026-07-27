import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { RecommendationRunDetail } from '../../data/recommendations.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'
import { STATUS_LABELS } from '../../utils/status.ts'

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

    return (
      <Document title={`Recommendations #${run.id} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <p>
            <a href={routes.recommendations.index.href()}>← All recommendations</a>
          </p>
          {prunedOldestRun && (
            <p mix={css({ color: '#15803d' })}>
              You can keep up to 3 recommendation runs at a time, so your oldest one was removed.
            </p>
          )}
          <h1>Recommendations #{run.id}</h1>
          <p mix={css({ color: '#555' })}>
            {date} — {run.groupLabel}
          </p>

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
              const detailHref = `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(routes.recommendations.show.href({ runId: String(run.id) }))}`

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
