import { clientEntry, ref } from 'remix/ui'

// A leaf sentinel, not a wrapper: FloatingDropdown's children are
// server-rendered forms (StatusSelect, StarRatingInput, ...) that a
// client-only bundle can't import or re-render, so this can't take them as
// props the way ProfileMenu takes its menu links. Instead it reaches up to
// the <details> that already exists in the server-rendered HTML.
export const FloatingDropdownCloser = clientEntry(import.meta.url, function FloatingDropdownCloser(handle) {
  return () => (
    <span
      hidden
      mix={ref((node, signal) => {
        const details = node.closest('details')
        if (!details) return

        document.addEventListener(
          'click',
          (event) => {
            if (!details.open) return
            if (details.contains(event.target as Node)) return
            details.open = false
          },
          { signal },
        )
      })}
    />
  )
})
