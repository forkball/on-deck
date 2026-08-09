import { clientEntry, ref } from 'remix/ui'

// A leaf sentinel, not a wrapper — like FloatingDropdownCloser, the <form> it
// enhances is server-rendered markup (StatusSelect, StarRatingInput, ...) that
// a client-only bundle can't import or re-render, so it can't be taken as a
// prop the way ProfileMenu takes its menu links. Instead this reaches up to
// the <form> that already exists in the server-rendered HTML and
// progressively enhances its submit.
//
// With JS off nothing is attached and the <form> posts natively — the
// server's redirect does a full navigation exactly as before. With JS on, the
// submit becomes a fetch, the enclosing Modal/FloatingDropdown (if any)
// closes, and the page updates via a top-frame reload instead of a
// navigation.
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

            void (async () => {
              const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
              for (const button of buttons) button.disabled = true

              try {
                const response = await fetch(form.action, {
                  method: 'POST',
                  body: new FormData(form),
                  signal,
                })
                if (signal.aborted) return

                if (!response.ok) {
                  window.location.href = response.url || form.action
                  return
                }

                // Reload happens before the frame swap replaces this form's
                // DOM, so these ancestor lookups still resolve.
                const overlay = form.closest('.modal-overlay')
                const toggle = overlay?.parentElement?.querySelector<HTMLInputElement>('input.modal-toggle')
                if (toggle) toggle.checked = false
                const details = form.closest('details')
                if (details) details.open = false

                await handle.frames.top.reload()
              } finally {
                if (!signal.aborted) for (const button of buttons) button.disabled = false
              }
            })()
          },
          { signal },
        )
      })}
    />
  )
})
