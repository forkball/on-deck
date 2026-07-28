import { clientEntry, css, on } from 'remix/ui'

export type LetterboxdImportFormProps = {
  uploadHref: string
}

// Client-hydrated (see generate-recommendations-form.tsx for the pattern):
// matching a few hundred ratings against TMDB one search per title is a
// genuine multi-second-to-tens-of-seconds wait, so this shows a disabled,
// "Importing…" button the instant you submit. The <form> still works as a
// plain POST without JS; this only adds feedback on top.
//
// The native file input's own chrome ("Choose File" + "No file chosen") is
// hidden — a <label> wrapping it acts as a single button, showing the picked
// filename once chosen instead (updated via a plain change listener).
export const LetterboxdImportForm = clientEntry<LetterboxdImportFormProps>(
  import.meta.url,
  function LetterboxdImportForm(handle) {
    let submitting = false
    let fileName: string | null = null

    return () => {
      const { uploadHref } = handle.props

      return (
        <form
          method="post"
          action={uploadHref}
          enctype="multipart/form-data"
          mix={[
            css({
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxWidth: '360px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
            }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <label
            class="doodle-border"
            mix={css({
              display: 'block',
              textAlign: 'center',
              padding: '8px 14px',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            })}
          >
            {fileName ?? 'Choose ratings.csv'}
            <input
              type="file"
              name="ratings"
              accept=".csv"
              required
              disabled={submitting}
              mix={[
                css({ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }),
                on('change', (event) => {
                  fileName = (event.target as HTMLInputElement).files?.[0]?.name ?? null
                  handle.update()
                }),
              ]}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            mix={css({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' })}
          >
            {submitting && (
              <span
                aria-hidden="true"
                mix={css({
                  '@keyframes letterboxd-import-spin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                  },
                  display: 'inline-block',
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  border: '2px solid currentColor',
                  borderTopColor: 'transparent',
                  animation: 'letterboxd-import-spin 0.6s linear infinite',
                })}
              />
            )}
            {submitting ? 'Importing…' : 'Upload and import'}
          </button>
        </form>
      )
    }
  },
)
