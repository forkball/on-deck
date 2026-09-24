import { clientEntry, ref } from 'remix/ui'

export type PasswordGateProps = {
  modalId: string
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

// Not a security control: the server runs the same check on a request that need
// not come from this form. This only moves the prompt in front of you before
// anything is sent.
export const PasswordGate = clientEntry<PasswordGateProps>(import.meta.url, function PasswordGate(handle) {
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
                original.size === 0 || [...original].some(([name, was]) => valueOf(form, name) !== was)
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
})
