import { clientEntry, css, on } from 'remix/ui'

export type MovieSearchFormProps = {
  query: string
  searchHref: string
}

// Client-hydrated (see generate-recommendations-form.tsx for the pattern):
// searching hits TMDB and imports results, a real network wait, so this
// swaps in a spinner + "Searching…" the instant you submit. The <form>
// still works as a plain GET without JS; this only adds feedback on top.
export const MovieSearchForm = clientEntry<MovieSearchFormProps>(
  import.meta.url,
  function MovieSearchForm(handle) {
    let submitting = false

    return () => {
      const { query, searchHref } = handle.props

      return (
        <form
          method="get"
          action={searchHref}
          mix={[
            css({ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search TMDB for a movie…"
            mix={css({ display: 'block', width: '100%' })}
          />
          <button
            type="submit"
            disabled={submitting}
            mix={css({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' })}
          >
            {submitting && (
              <span
                aria-hidden="true"
                mix={css({
                  '@keyframes movie-search-spin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                  },
                  display: 'inline-block',
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  border: '2px solid currentColor',
                  borderTopColor: 'transparent',
                  animation: 'movie-search-spin 0.6s linear infinite',
                })}
              />
            )}
            {submitting ? 'Searching…' : 'Search'}
          </button>
        </form>
      )
    }
  },
)
