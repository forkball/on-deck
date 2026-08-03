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
export const LazyList = clientEntry<LazyListProps>(
  import.meta.url,
  function LazyList(handle) {
    return () => {
      const { listId, initial, step } = handle.props

      return (
        <div
          mix={[
            // Needs a little height so it can actually intersect the viewport.
            css({ height: '1px' }),
            ref((node, signal) => {
              const list = document.getElementById(listId)
              if (!list) return

              const items = Array.from(list.children) as HTMLElement[]
              if (items.length <= initial) return

              let shown = initial
              const apply = () => {
                for (const [index, item] of items.entries()) {
                  item.style.display = index < shown ? '' : 'none'
                }
              }
              apply()

              const observer = new IntersectionObserver((entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                shown += step
                apply()
                if (shown >= items.length) observer.disconnect()
              })
              observer.observe(node)
              signal.addEventListener('abort', () => observer.disconnect())
            }),
          ]}
        />
      )
    }
  },
)
