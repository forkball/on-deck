import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import type { RecommendationRunSummary } from '../../data/recommendations/runs.ts'
import { routes } from '../../routes.ts'

export interface RunListProps {
  runs: RecommendationRunSummary[]
  // Off by default, because the recommendations index is already filtered to
  // one type and a badge on every row there would say the same word twice. The
  // home page mixes all four, where the type is the thing telling them apart.
  showMediaType?: boolean
}

export function RunList(handle: Handle<RunListProps>) {
  return () => {
    const { runs, showMediaType = false } = handle.props

    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        })}
      >
        {runs.map((run) => {
          const date = new Date(run.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          return (
            <li
              key={run.id}
              mix={css({
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '12px 16px',
              })}
            >
              <a href={routes.recommendations.show.href({ runId: String(run.id) })}>
                {run.name ? (
                  <>
                    <strong>{run.name}</strong> — {date}
                  </>
                ) : (
                  <>
                    <strong>{date}</strong> — {run.groupLabel}
                  </>
                )}
              </a>
              {showMediaType && (
                <span mix={css({ flex: '0 0 auto', fontSize: '12px', color: '#888' })}>
                  {mediaTypeUiFor(run.mediaType).tabLabel}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    )
  }
}
