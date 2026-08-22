import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { mediaTypeLabel } from '../../mediaTypes.ts'
import type { RecommendationRunSummary } from '../../data/recommendations/runs.ts'
import { routes } from '../../routes.ts'

export interface RunListProps {
  runs: RecommendationRunSummary[]
  // 'list' is a full-width row, everything on one line, the way the
  // recommendations index has always shown a run. 'panel' is the same row in a
  // column too narrow for that, so it stacks — and that second line is where
  // the media type earns a place, since the index is filtered to one type and
  // would say the same word on every row.
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

          return (
            <li
              key={run.id}
              mix={css({
                // Flex either way, and not only for the layout: DoodleCSS puts
                // a "* " marker on `.doodle ul li` at a specificity nothing
                // here can beat, and a list item that isn't display: list-item
                // has nowhere to put one.
                display: 'flex',
                border: '1px solid #ddd',
                borderRadius: '8px',
                ...(panel
                  ? { flexDirection: 'column', padding: '10px 12px' }
                  : {
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 16px',
                    }),
              })}
            >
              <a href={routes.recommendations.show.href({ runId: String(run.id) })}>
                {run.isLucky && '🎲 '}
                <strong>{run.name || date}</strong>
                {!panel && (run.name ? <> — {date}</> : <> — {run.groupLabel}</>)}
              </a>
              {/* The line the narrow row had to break out: whatever the link
                  above didn't already say. */}
              {panel && (
                <p mix={css({ margin: '2px 0 0', fontSize: '12px', color: '#888' })}>
                  {run.name ? `${date} — ` : ''}
                  {run.groupLabel} · {mediaTypeLabel(run.mediaType)}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    )
  }
}
