import { clientEntry, ref } from 'remix/ui'

// Reaches up to the server-rendered <form> it sits in rather than wrapping it —
// the form's fields are server UI a client bundle can't import. With JS off
// nothing attaches and the form posts natively.
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
