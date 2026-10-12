import { clientEntry, css, ref } from 'remix/ui'

import { Spinner } from './shared/spinner.tsx'

const spinnerSlot = css({
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 0',
  color: 'var(--muted)',
  // `display: flex` would otherwise beat the attribute's own display: none.
  '&[hidden]': { display: 'none' },
})

// Placed where a GET filter form's results are, and handed the form's id and
// the results' id. Any change to the form submits it, so a pick takes effect
// without a button, and until the new page arrives the results are swapped for
// a spinner — the form itself stays put. Put the form's own submit button in a
// <noscript>: with JS off the form still works by pressing it.
//
// The swap is done on the DOM directly rather than by re-rendering: once the
// submit starts the navigation, the page no longer paints a scheduled update.
export const SubmitOnChange = clientEntry<{ form: string; results: string }>(
  import.meta.url,
  function SubmitOnChange(handle) {
    return () => (
      <div
        hidden
        mix={[
          spinnerSlot,
          ref((node, signal) => {
            const form = document.getElementById(handle.props.form)
            const results = document.getElementById(handle.props.results)
            if (!(form instanceof HTMLFormElement)) return

            const loading = (on: boolean) => {
              node.hidden = !on
              if (results) results.hidden = on
            }
            form.addEventListener(
              'change',
              () => {
                loading(true)
                form.requestSubmit()
              },
              { signal },
            )
            // Coming back from the back/forward cache restores the page as it
            // was left — mid-submit — so the list comes back.
            window.addEventListener('pageshow', () => loading(false), { signal })
          }),
        ]}
      >
        <Spinner size={28} />
      </div>
    )
  },
)
