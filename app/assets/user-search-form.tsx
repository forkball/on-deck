import { clientEntry, css, on, ref } from 'remix/ui'

import { SuggestionDropdown } from './ui/suggestion-dropdown.tsx'
import { createSuggestionFetcher, EMPTY_SUGGEST_STATE, type SuggestState, type Suggestion } from './ui/suggestions.ts'

export type UserSearchFormProps = {
  query: string
  searchHref: string
  suggestHref: string
}

// Client-hydrated (see generate-recommendations-form.tsx for the pattern).
// The <form> still works as a plain GET without JS; this adds a submit
// spinner plus an autosuggest dropdown (debounced request to suggestHref,
// its own loading state) — picking a suggestion submits the real search
// immediately, landing on the results list with its Follow/Unfollow
// buttons. Mirrors movie-search-form.tsx.
export const UserSearchForm = clientEntry<UserSearchFormProps>(
  import.meta.url,
  function UserSearchForm(handle) {
    let submitting = false
    let query = handle.props.query
    let suggestState: SuggestState = EMPTY_SUGGEST_STATE
    let inputNode: HTMLInputElement | null = null

    const fetcher = createSuggestionFetcher({
      suggestHref: handle.props.suggestHref,
      signal: handle.signal,
      onChange: (state) => {
        suggestState = state
        handle.update()
      },
    })

    function selectSuggestion(suggestion: Suggestion) {
      query = suggestion.label
      suggestState = EMPTY_SUGGEST_STATE
      if (inputNode) inputNode.value = suggestion.label
      handle.update()
      inputNode?.form?.requestSubmit()
    }

    return () => {
      const { searchHref } = handle.props

      return (
        <form
          method="get"
          action={searchHref}
          mix={[
            css({ display: 'flex', gap: '8px', marginBottom: '24px' }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <div
            mix={[
              css({ position: 'relative', flex: '1 1 auto', minWidth: 0 }),
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
              placeholder="Search by name or email…"
              mix={[
                css({ display: 'block', width: '100%' }),
                ref((node) => {
                  inputNode = node as HTMLInputElement
                }),
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
                  '@keyframes user-search-spin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                  },
                  display: 'inline-block',
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  border: '2px solid currentColor',
                  borderTopColor: 'transparent',
                  animation: 'user-search-spin 0.6s linear infinite',
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
