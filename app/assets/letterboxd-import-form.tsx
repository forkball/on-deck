import { clientEntry, css, on } from 'remix/ui'

export type LetterboxdImportFormProps = {
  uploadHref: string
}

// Client-hydrated (see generate-recommendations-form.tsx for the pattern):
// matching a few hundred ratings against TMDB one search per title is a
// genuine multi-second-to-tens-of-seconds wait, so this shows a disabled,
// "Importing…" button the instant you submit. The <form> still works as a
// plain POST without JS; this only adds feedback on top.
export const LetterboxdImportForm = clientEntry<LetterboxdImportFormProps>(
  import.meta.url,
  function LetterboxdImportForm(handle) {
    let submitting = false

    return () => {
      const { uploadHref } = handle.props

      return (
        <form
          method="post"
          action={uploadHref}
          enctype="multipart/form-data"
          mix={[
            css({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px' }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <input type="file" name="export" accept=".zip" required disabled={submitting} />
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
            {submitting ? 'Importing… this can take a minute' : 'Upload and import'}
          </button>
        </form>
      )
    }
  },
)
