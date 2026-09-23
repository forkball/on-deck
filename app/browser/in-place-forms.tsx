import { clientEntry, ref } from 'remix/ui'

import { submitInPlace } from './shared/submit-in-place.ts'

// FrameForm for a whole page at once: every <form data-in-place> posts in the
// background and the page updates where it stands, through one delegated
// listener rather than a client entry per form. The import review renders a
// few forms per card and hundreds of cards, and one entry each tripped the
// runtime's update-loop guard while hydrating.
//
// With JS off nothing attaches and each form posts natively.
export const InPlaceForms = clientEntry(import.meta.url, function InPlaceForms(handle) {
  return () => (
    <span
      hidden
      mix={ref((_node, signal) => {
        document.addEventListener(
          'submit',
          (event) => {
            const form = event.target
            if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-in-place')) return

            event.preventDefault()
            void submitInPlace(form, signal, async () => {
              await handle.frames.top.reload()
            })
          },
          { signal },
        )
      })}
    />
  )
})
