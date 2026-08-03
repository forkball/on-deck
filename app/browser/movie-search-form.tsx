import { clientEntry, css, on, ref } from 'remix/ui'

import { SuggestionDropdown } from './shared/suggestion-dropdown.tsx'
import { createSuggestionFetcher, EMPTY_SUGGEST_STATE, type SuggestState, type Suggestion } from './shared/suggestions.ts'

export type MovieSearchFormProps = {
  query: string
  searchHref: string
  suggestHref: string
  importHref: string
  placeholder?: string
}

// The <form> works as a plain GET without JS; this adds a spinner over it,
// since searching hits the catalog and imports results.
//
// Also drives the autosuggest dropdown. Because the suggest endpoint already
// resolved a pick to an exact id, selecting one goes straight to importHref
// rather than resubmitting a title search — which cost two catalog calls and
// could resolve to a different item.
export const MovieSearchForm = clientEntry<MovieSearchFormProps>(
  import.meta.url,
  function MovieSearchForm(handle) {
    let submitting = false
    let query = handle.props.query
    let suggestState: SuggestState = EMPTY_SUGGEST_STATE

    const fetcher = createSuggestionFetcher({
      suggestHref: handle.props.suggestHref,
      signal: handle.signal,
      onChange: (state) => {
        suggestState = state
        handle.update()
      },
    })

    function selectSuggestion(suggestion: Suggestion) {
      const { importHref, searchHref, query: initialQuery } = handle.props
      const from = `${searchHref}?q=${encodeURIComponent(query || initialQuery)}`
      window.location.href =
        `${importHref}?externalId=${encodeURIComponent(suggestion.key)}&from=${encodeURIComponent(from)}`
    }

    return () => {
      const { searchHref, placeholder = 'Search TMDB for a movie…' } = handle.props

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
          <div
            mix={[
              css({ position: 'relative' }),
              ref((node, signal) => {
                document.addEventListener(
                  'click',
                  (event) => {
                    if (!(event.target instanceof Node) || node.contains(event.target)) return
                    suggestState = EMPTY_SUGGEST_STATE
                    handle.update()
                  },
                  { signal },
                )
              }),
            ]}
          >
            <input
              type="text"
              name="q"
              value={query}
              autocomplete="off"
              placeholder={placeholder}
              mix={[
                css({ display: 'block', width: '100%' }),
                on('input', (event) => {
                  query = (event.target as HTMLInputElement).value
                  fetcher.query(query)
                  handle.update()
                }),
                on('keydown', (event) => {
                  if (event.key !== 'Escape') return
                  suggestState = EMPTY_SUGGEST_STATE
                  handle.update()
                }),
              ]}
            />
            {suggestState.open && <SuggestionDropdown state={suggestState} onSelect={selectSuggestion} />}
          </div>


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
