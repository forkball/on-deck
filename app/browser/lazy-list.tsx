import { clientEntry, css, ref } from 'remix/ui'

export type LazyListProps = {
  // id of the server-rendered list whose children get revealed.
  listId: string
  initial: number
  step: number
}

// Reveals a server-rendered list as you scroll.
//
// Deliberately doesn't render the list itself: client entry props are
// JSON-serialized, so an entry can't wrap server-rendered children, and the row
// markup needs components under app/ui that this can't import. Instead it
// renders a sentinel after the list and reaches for the list by id.
//
// With JS off nothing hides anything and the full list shows, which is why the
// server renders every result rather than a slice. The whole set arrives in one
// revealing more costs no extra network.
//
// Hides with a stylesheet it renders itself rather than by setting
// `style.display` on the items. The list is server markup, so an in-place frame
// reload (FrameForm, the import picker) diffs it back to what the server sent —
// which wiped inline styles and unfolded the whole list after a single
// decision. This entry's own state survives the reload, so the rule does too;
// and a removed item simply lets the next one move up into view.
export const LazyList = clientEntry<LazyListProps>(import.meta.url, function LazyList(handle) {
  // Null until the browser has run this: the server render must hide nothing,
  // or with JS off the tail would be unreachable.
  let shown: number | null = null

  return () => {
    const { listId, initial, step } = handle.props

    return (
      <>
        {/* Always rendered, empty until the browser takes over, so the
            sentinel beside it keeps its place: a node appearing in front of it
            re-created it, which re-ran its ref and looped. */}
        <style>
          {shown == null ? '' : `#${CSS.escape(listId)} > :nth-child(n + ${shown + 1}) { display: none; }`}
        </style>
        <div
          mix={[
            // Needs a little height so it can actually intersect the viewport.
            css({ height: '1px' }),
            ref((node, signal) => {
              const list = document.getElementById(listId)
              if (!list || list.children.length <= initial) return

              if (shown == null) {
                shown = initial
                handle.update()
              }

              const observer = new IntersectionObserver((entries) => {
                if (shown == null || !entries.some((entry) => entry.isIntersecting)) return
                if (shown >= list.children.length) {
                  observer.disconnect()
                  return
                }
                shown += step
                handle.update()
              })
              observer.observe(node)
              signal.addEventListener('abort', () => observer.disconnect())
            }),
          ]}
        />
      </>
    )
  }
})
