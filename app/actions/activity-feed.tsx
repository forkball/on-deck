import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { FeedItem } from '../data/feed.ts'
import { mediaTypeUiFor } from '../mediaTypes.ts'
import { routes } from '../routes.ts'
import { RunListItem } from '../ui/components/run-list.tsx'
import { WatchedListItem } from '../ui/components/watched-list-item.tsx'

// The id the list is reached by. The auto-loader appends to it from the browser
// and the fragment route renders rows for it, so the two have to agree on a
// name — it lives here rather than being spelled out in both.
export const FEED_LIST_ID = 'home-activity'

// Where a run opened from the feed goes back to. The feed is only ever the
// landing page's, and it is rendered both by that page and by the fragment
// route the auto-loader appends from, so it is named here rather than threaded
// identically through both.
const FEED_RETURN_TO = routes.home.href()

// The rows of one page of the feed, and nothing around them.
//
// Separate from the list because it is rendered twice by different callers: the
// page renders it inside the <ul>, and the fragment route renders it alone, for
// markup the browser appends to that same <ul>. Keeping one component for the
// rows is what stops an appended row from drifting out of step with a
// server-rendered one.
export function FeedRows(handle: Handle<{ items: FeedItem[] }>) {
  return () => (
    <>
      {handle.props.items.map((item) =>
        item.kind === 'run' ? (
          <RunListItem key={`run-${item.id}`} run={item.run} variant="feed" returnTo={FEED_RETURN_TO} />
        ) : (
          <WatchedListItem
            key={`log-${item.id}`}
            interaction={item.entry.interaction}
            item={item.entry.item}
            detailHref={
              item.entry.item ? mediaTypeUiFor(item.entry.item.type).hrefs.show(item.entry.item.id) : '#'
            }
            actor={item.entry.actor}
          />
        ),
      )}
    </>
  )
}

export function FeedList(handle: Handle<{ items: FeedItem[] }>) {
  return () => (
    <ul
      id={FEED_LIST_ID}
      mix={css({
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      })}
    >
      <FeedRows items={handle.props.items} />
    </ul>
  )
}
