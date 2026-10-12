import { clientEntry, ref } from 'remix/ui'

// A leaf sentinel placed inside a GET filter form: any change to the form
// submits it, so a pick takes effect without a button. The form's own submit
// button is hidden once this runs — with JS off it stays, and the form still
// works by pressing it.
export const SubmitOnChange = clientEntry(import.meta.url, function SubmitOnChange() {
  return () => (
    <span
      hidden
      mix={ref((node, signal) => {
        const form = node.closest('form')
        if (!form) return

        for (const button of form.querySelectorAll<HTMLElement>('[type="submit"]')) {
          button.style.display = 'none'
        }
        form.addEventListener('change', () => form.requestSubmit(), { signal })
      })}
    />
  )
})
