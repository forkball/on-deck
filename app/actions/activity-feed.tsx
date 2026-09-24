import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { FeedItem } from '../data/feed.ts'
import { groupFeed } from '../data/feedGroups.ts'
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

// One row, whichever of the two kinds it is.
function FeedRow(handle: Handle<{ item: FeedItem }>) {
  return () => {
    const { item } = handle.props
    return item.kind === 'run' ? (
      <RunListItem run={item.run} variant="feed" returnTo={FEED_RETURN_TO} />
    ) : (
      <WatchedListItem
        interaction={item.entry.interaction}
        item={item.entry.item}
        detailHref={
          item.entry.item ? mediaTypeUiFor(item.entry.item.type).hrefs.show(item.entry.item.id) : '#'
        }
        actor={item.entry.actor}
      />
    )
  }
}

// The viewer's locale, as every other date on the page. formatRange rather than
// two formatted dates joined by a dash: it drops what the ends share, so a
// burst within one month reads "Sep 5 – 24, 2026" and one within a day reads
// as that day alone.
const RANGE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

// What the divider says about the rows behind it: who, how many of what, and
// over what stretch of time. Each of those is shared by every row in the group
// — that is what groupKeyOf guarantees — so the sentence is true of all of them.
function groupSummary(items: FeedItem[]): { who: string; what: string; when: string } {
  const first = items[0]
  const count = items.length

  let who: string
  let what: string
  if (first.kind === 'run') {
    who = first.run.owner?.label ?? 'You'
    what = `generated ${count} recommendations`
  } else {
    who = first.entry.actor.label
    // Named by type when the burst is all one type, which an import always is.
    const types = new Set(items.map((item) => (item.kind === 'log' ? item.entry.item?.type : null)))
    const [type] = types
    what = `logged ${count} ${types.size === 1 && type ? mediaTypeUiFor(type).plural : 'titles'}`
  }

  // Newest first, so the oldest is last.
  const when = RANGE_FORMAT.formatRange(new Date(items[count - 1].at), new Date(first.at))
  return { who, what, when }
}

const GROUP_STYLE = css({
  // Flex for the same reason RunListItem is: it keeps DoodleCSS's list marker off.
  display: 'flex',
  flexDirection: 'column',
  '& > details > summary': {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    listStyle: 'none',
    fontSize: '14px',
    color: '#555',
  },
  '& > details > summary::-webkit-details-marker': { display: 'none' },
  // The rules either side of the label that make it read as a divider.
  '& > details > summary::before, & > details > summary::after': {
    content: '""',
    flex: '1 1 24px',
    borderTop: '1px dashed #bbb',
  },
  '& .chevron': { display: 'inline-block', transition: 'transform 120ms ease' },
  '& > details[open] > summary .chevron': { transform: 'rotate(90deg)' },
  '& .when': { color: '#888', fontSize: '12px' },
})

const GROUP_BODY_STYLE = css({
  listStyle: 'none',
  margin: '12px 0 0',
  padding: '0 0 0 12px',
  borderLeft: '2px solid #eee',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
})

// A run of one person's rows folded behind a divider — see feedGroups.ts for
// when that happens. Open at first, so nothing is hidden until the reader
// chooses to fold a burst they've seen away; the divider still marks where one
// person's run of activity starts and how far it reaches.
//
// A native <details>, as Collapsible is, so toggling it needs no script — which
// matters here, since appended pages arrive as markup and nothing hydrates them.
function FeedGroup(handle: Handle<{ items: FeedItem[] }>) {
  return () => {
    const { items } = handle.props
    const { who, what, when } = groupSummary(items)

    return (
      <li mix={GROUP_STYLE}>
        <details open>
          <summary>
            <span>
              <span class="chevron" aria-hidden="true">
                ▸
              </span>{' '}
              <strong>{who}</strong> {what} <span class="when">· {when}</span>
            </span>
          </summary>
          <ul mix={GROUP_BODY_STYLE}>
            {items.map((item) => (
              <FeedRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
        </details>
      </li>
    )
  }
}

// The rows of one page of the feed, and nothing around them.
//
// Separate from the list because it is rendered twice by different callers: the
// page renders it inside the <ul>, and the fragment route renders it alone, for
// markup the browser appends to that same <ul>. Keeping one component for the
// rows is what stops an appended row from drifting out of step with a
// server-rendered one.
//
// Grouping happens here, per page, which is only sound because a page never
// ends partway through a group — see loadGroupedFeedPage.
export function FeedRows(handle: Handle<{ items: FeedItem[] }>) {
  return () => (
    <>
      {groupFeed(handle.props.items).map((entry) =>
        entry.kind === 'group' ? (
          <FeedGroup
            key={`group-${entry.key}-${entry.items[0].kind}-${entry.items[0].id}`}
            items={entry.items}
          />
        ) : (
          <FeedRow key={`${entry.item.kind}-${entry.item.id}`} item={entry.item} />
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
