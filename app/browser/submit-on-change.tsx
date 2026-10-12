import { clientEntry, ref } from 'remix/ui'

// A leaf sentinel placed inside a GET filter form: any change to the form
// submits it, so a pick takes effect without a button. Put the form's own
// submit button in a <noscript>: with JS off the form still works by pressing
// it, and with JS on it's never drawn, rather than drawn and then hidden.
export const SubmitOnChange = clientEntry(import.meta.url, function SubmitOnChange() {
  return () => (
    <span
      hidden
      mix={ref((node, signal) => {
        const form = node.closest('form')
        if (!form) return

        form.addEventListener('change', () => form.requestSubmit(), { signal })
      })}
    />
  )
})
