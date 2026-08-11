import { clientEntry, ref } from 'remix/ui'

// Clicking the star you already picked clears the rating.
//
// A leaf sentinel like FloatingDropdownCloser, and for the same reason: the
// star picker is server-rendered markup a client-only bundle can't import or
// re-render, so this reaches up to the group that already exists in the HTML
// rather than wrapping it.
//
// It exists because a radio cannot be unchecked by clicking it — the browser
// treats a click on an already-selected radio as a no-op, and no CSS changes
// that. The picker is otherwise script-free, so this is the one behaviour that
// needs one: without it a rating could be changed but never taken back.
//
// Intercepted at capture, before the label forwards activation to its input.
// `checked` is still the pre-click state there, so a click landing on the
// current selection is the one to cancel: preventDefault stops the label from
// re-selecting it, and clearing `checked` leaves the group with nothing
// selected. The field then submits nothing at all, which the log action reads
// as the empty string, which is unrated.
export const StarRatingClearer = clientEntry(import.meta.url, function StarRatingClearer(handle) {
  return () => (
    <span
      hidden
      mix={ref((node, signal) => {
        const group = node.closest('.rating-group')
        if (!group) return

        group.addEventListener(
          'click',
          (event) => {
            const target = event.target as Element | null
            const label = target?.closest?.('label[for]')
            if (!label || !group.contains(label)) return

            const input = document.getElementById(label.getAttribute('for') ?? '')
            if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return
            // A click on anything not already selected is an ordinary pick.
            if (!input.checked) return

            event.preventDefault()
            input.checked = false
          },
          { capture: true, signal },
        )
      })}
    />
  )
})
