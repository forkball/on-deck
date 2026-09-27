import { clientEntry, ref } from 'remix/ui'

import { submitInPlace } from './shared/submit-in-place.ts'

// Every <form data-in-place> posts in place through one delegated listener (a
// client entry per form trips the update-loop guard on long pages). A form in a
// <details data-close-on-submit> folds it afterwards. With JS off, forms post natively.
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
              form.closest('details[data-close-on-submit]')?.removeAttribute('open')
              await handle.frames.top.reload()
            })
          },
          { signal },
        )
      })}
    />
  )
})
