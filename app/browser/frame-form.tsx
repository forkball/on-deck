import { clientEntry, ref } from 'remix/ui'

import { submitInPlace } from './shared/submit-in-place.ts'

// Reaches up to the server-rendered <form> it sits in rather than wrapping it —
// the form's fields are server UI a client bundle can't import. With JS off
// nothing attaches and the form posts natively.
//
// One client entry per form; pages with many use InPlaceForms. Both close the
// form's dropdown or modal the same way — see submitInPlace.
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

            void submitInPlace(form, signal, () => handle.frames.top.reload())
          },
          { signal },
        )
      })}
    />
  )
})
