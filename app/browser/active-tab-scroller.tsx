import { clientEntry, ref } from 'remix/ui'

// Brings the active tab into view in a tab bar that scrolls sideways
// (TAB_BAR_SCROLL in ui/components/tabs.tsx). Without it a page opened on a
// tab past the edge — People on a narrow phone, a profile linked to its last
// tab — shows a bar with nothing marked as current.
//
// A leaf sentinel like FloatingDropdownCloser: the bar is server-rendered, so
// this sits inside it and reaches up to its parent rather than wrapping it.
// It reads both kinds of bar: MediaTabLinks marks its current link with
// aria-current, and Tabs' labels are current when the radio they name is
// checked.
//
// Sets the bar's own scrollLeft rather than calling scrollIntoView, which
// would also scroll the page to the bar. Centred, so the tabs either side of
// it show too. Once, on load: a click can only land on a tab already in view.
export const ActiveTabScroller = clientEntry(import.meta.url, function ActiveTabScroller(handle) {
  return () => (
    <span
      hidden
      mix={ref((node) => {
        const bar = node.parentElement
        if (!bar || bar.scrollWidth <= bar.clientWidth) return

        const active =
          bar.querySelector('[aria-current]') ??
          [...bar.querySelectorAll('label[for]')].find((label) => {
            const input = document.getElementById(label.getAttribute('for') ?? '')
            return input instanceof HTMLInputElement && input.checked
          })
        if (!active) return

        const barBox = bar.getBoundingClientRect()
        const tabBox = active.getBoundingClientRect()
        bar.scrollLeft += tabBox.left - barBox.left - (barBox.width - tabBox.width) / 2
      })}
    />
  )
})
