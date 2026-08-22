import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import type { RecommendationRunSummary } from '../../data/recommendations/runs.ts'
import { routes } from '../../routes.ts'

export interface RunListProps {
  runs: RecommendationRunSummary[]
  // 'list' is a full-width row: everything on one line, the way the
  // recommendations index has always shown a run. 'panel' is the same rows in a
  // column narrow enough that they have to stack, which is also where the media
  // type earns a place — the index is filtered to one type and would say the
  // same word on every row.
  variant?: 'list' | 'panel'
}

export function RunList(handle: Handle<RunListProps>) {
  return () => {
    const { runs, variant = 'list' } = handle.props
    const panel = variant === 'panel'

    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: panel ? '8px' : '12px',
        })}
      >
        {runs.map((run) => {
          const date = new Date(run.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })

          if (panel) {
            return (
              <li
                key={run.id}
                mix={css({
                  // Flex for the same reason the row below is: DoodleCSS puts a
                  // "* " marker on `.doodle ul li`, whose specificity beats
                  // anything stated here — but a list item that isn't
                  // display: list-item has no marker box to put it in.
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '10px 12px',
                })}
              >
                <a href={routes.recommendations.show.href({ runId: String(run.id) })}>
                  {run.isLucky && '🎲 '}
                  <strong>{run.name || date}</strong>
                </a>
                {/* The line the row was too narrow to keep: whatever the link
                    above didn't already say. */}
                <p mix={css({ margin: '2px 0 0', fontSize: '12px', color: '#888' })}>
                  {run.name ? `${date} — ` : ''}
                  {run.groupLabel} · {mediaTypeUiFor(run.mediaType).tabLabel}
                </p>
              </li>
            )
          }

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
                {run.isLucky && '🎲 '}
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
            </li>
          )
        })}
      </ul>
    )
  }
}
