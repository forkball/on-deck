import { clientEntry, ref } from 'remix/ui'

import { submitInPlace } from './shared/submit-in-place.ts'

// Reaches up to the server-rendered <form> it sits in rather than wrapping it —
// the form's fields are server UI a client bundle can't import. With JS off
// nothing attaches and the form posts natively.
//
// One client entry per form; pages with many use InPlaceForms.
export const FrameForm = clientEntry(import.meta.url, function FrameForm(handle) {
  return () => (
    <span
      hidden
      mix={ref((node, signal) => {
        const form = node.closest('form')
        if (!form) return

        form.addEventListener(
          'submit',
          (event) => {
            event.preventDefault()

            void submitInPlace(form, signal, async () => {
              // Reload happens before the frame swap replaces this form's
              // DOM, so these ancestor lookups still resolve.
              const overlay = form.closest('.modal-overlay')
              const toggle = overlay?.parentElement?.querySelector<HTMLInputElement>('input.modal-toggle')
              if (toggle) toggle.checked = false
              const details = form.closest('details')
              if (details) details.open = false

              await handle.frames.top.reload()
            })
          },
          { signal },
        )
      })}
    />
  )
})
