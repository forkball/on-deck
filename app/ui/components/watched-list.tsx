import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { listUserMediaLog } from '../../data/mediaItems.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { WatchedListItem } from './watched-list-item.tsx'
import { withReturnTo } from '../backLink.ts'

type LogEntries = Awaited<ReturnType<typeof listUserMediaLog>>

export interface WatchedListProps {
  log: LogEntries
  mediaType: ActiveMediaType
  // Where a detail page reached from this list should send the reader back to:
  // the list as it stands, page and filter included.
  returnTo: string
  // Rendered beside each row. Your own log offers an edit modal here; someone
  // else's offers nothing, which is the only difference between the two lists.
  actions?: (entry: LogEntries[number]) => RemixNode
}

// The log itself, shared by your own watched page and by someone else's.
//
// Not the whole page: the two differ in heading, in whether there is a status
// filter above the list, and in how they page. What they agree on is the rows —
// and, more to the point, the detail link, which has to carry the list it was
// opened from so the detail page can offer a way back to it.
//
// The home feed builds its own list rather than using this one: its rows are a
// mix of logs and generated runs, it carries no return path, and it is split
// so the browser can append a page of rows to a list already on screen.
export function WatchedList(handle: Handle<WatchedListProps>) {
  return () => {
    const { log, mediaType, returnTo, actions } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]

    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        })}
      >
        {log.map((entry) => {
          const { interaction, item } = entry
          // A row whose match was never settled has no detail page to open.
          const detailHref = item ? withReturnTo(ui.hrefs.show(item.id), returnTo) : '#'

          return (
            <WatchedListItem
              key={interaction.id}
              interaction={interaction}
              item={item}
              detailHref={detailHref}
              actions={actions?.(entry)}
            />
          )
        })}
      </ul>
    )
  }
}
