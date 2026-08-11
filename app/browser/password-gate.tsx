import { clientEntry, ref } from 'remix/ui'

export type PasswordGateProps = {
  // The Modal holding the password box, so this can open it.
  modalId: string
  // Name of the password input inside that modal.
  passwordField: string
  // Fields whose change is what makes the password necessary. Omitted means
  // the form always needs one — the change-password form itself, where there
  // is nothing to compare against.
  guardedFields?: string[]
}

function valueOf(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name)
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : ''
}

// A leaf sentinel like FrameForm: it reaches up to the server-rendered <form>
// it sits in rather than wrapping it, because the form's fields are server UI
// a client bundle can't import.
//
// What it buys is the timing. The server already refuses a handle change that
// arrives without a password and re-renders with the modal open, so the
// no-JS path works — it just costs a round trip and a page reload to find
// out. Here the check happens on submit, so the modal is in front of you
// before anything is sent, and the page you typed into is still the page you
// are looking at.
//
// It is not a security control and can't be: the server does the same check
// again on a request that never has to come from this form at all.
export const PasswordGate = clientEntry<PasswordGateProps>(
  import.meta.url,
  function PasswordGate(handle) {
    return () => {
      const { modalId, passwordField, guardedFields } = handle.props

      return (
        <span
          hidden
          mix={ref((node, signal) => {
            const form = node.closest('form')
            if (!form) return

            // Read after the server's values are in the DOM but before anyone
            // has typed, so this is what the account currently holds.
            const original = new Map((guardedFields ?? []).map((name) => [name, valueOf(form, name)]))

            form.addEventListener(
              'submit',
              (event) => {
                if (valueOf(form, passwordField) !== '') return

                // No guarded fields named means every submit needs one.
                const needsPassword =
                  original.size === 0 ||
                  [...original].some(([name, was]) => valueOf(form, name) !== was)
                if (!needsPassword) return

                event.preventDefault()

                const toggle = document.getElementById(modalId)
                if (toggle instanceof HTMLInputElement) toggle.checked = true

                const input = form.elements.namedItem(passwordField)
                if (input instanceof HTMLInputElement) input.focus()
              },
              { signal },
            )
          })}
        />
      )
    }
  },
)
