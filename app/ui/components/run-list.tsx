import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { mediaTypeUiFor } from '../../mediaTypes.ts'
import type { RecommendationRunSummary } from '../../data/recommendations/runs.ts'
import { routes } from '../../routes.ts'

// 'list' is a full-width row, everything on one line, the way the
// recommendations index has always shown a run. 'feed' is the home page's
// merged activity list, where a run sits among other people's log entries: it
// stacks onto two lines and names who generated it, because there it is no
// longer a run under a heading that already said so.
export type RunListVariant = 'list' | 'feed'

export interface RunListItemProps {
  run: RecommendationRunSummary
  variant?: RunListVariant
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// One run as a list item. Exported on its own because the home feed interleaves
// these with log rows in a single <ul> — it needs the row without the list.
export function RunListItem(handle: Handle<RunListItemProps>) {
  return () => {
    const { run, variant = 'list' } = handle.props
    const feed = variant === 'feed'
    const date = formatDate(run.createdAt)

    return (
      <li
        mix={css({
          // Flex either way, and not only for the layout: DoodleCSS puts a "* "
          // marker on `.doodle ul li` at a specificity nothing here can beat,
          // and a list item that isn't display: list-item has nowhere to put one.
          display: 'flex',
          border: '1px solid #ddd',
          borderRadius: '8px',
          ...(feed
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
          {!feed && (run.name ? <> — {date}</> : <> — {run.groupLabel}</>)}
        </a>

        {/* Who made it, as a sentence, the way a log row says "mona watched" —
            in the feed that is the only thing saying so. `attributive` rather
            than the tab label, which is plural: "a movie recommendation", not
            "a movies recommendation". */}
        {feed && (
          <p mix={css({ margin: '2px 0 0' })}>
            {run.owner ? (
              <>
                <a href={routes.users.show.href({ userId: String(run.owner.id) })}>{run.owner.label}</a>{' '}
                generated a {mediaTypeUiFor(run.mediaType).attributive} recommendation
              </>
            ) : (
              <>You generated a {mediaTypeUiFor(run.mediaType).attributive} recommendation</>
            )}
          </p>
        )}

        {/* The line the stacked row had to break out: whatever the link above
            didn't already say. */}
        {feed && (
          <p mix={css({ margin: '2px 0 0', fontSize: '12px', color: '#888' })}>
            {run.name ? `${date} — ` : ''}
            {run.groupLabel}
          </p>
        )}
      </li>
    )
  }
}

export interface RunListProps {
  runs: RecommendationRunSummary[]
  variant?: RunListVariant
}

export function RunList(handle: Handle<RunListProps>) {
  return () => {
    const { runs, variant = 'list' } = handle.props

    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: variant === 'feed' ? '8px' : '12px',
        })}
      >
        {runs.map((run) => (
          <RunListItem key={run.id} run={run} variant={variant} />
        ))}
      </ul>
    )
  }
}
