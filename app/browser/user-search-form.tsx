import { clientEntry, css, on, ref } from 'remix/ui'

import { SuggestionDropdown } from './shared/suggestion-dropdown.tsx'
import { createSuggestionFetcher, EMPTY_SUGGEST_STATE, type SuggestState, type Suggestion } from './shared/suggestions.ts'

export type UserSearchFormProps = {
  query: string
  searchHref: string
  suggestHref: string
  // routes.users.show.href({ userId: PROFILE_HREF_PLACEHOLDER }) — the
  // placeholder gets swapped for the picked suggestion's key client-side.
  // app/routes.ts can't be imported into the browser bundle (see
  // scripts/check-browser-bundle.ts), so the server resolves the template.
  profileHrefTemplate: string
}

export const PROFILE_HREF_PLACEHOLDER = '__USER_ID__'

// Client-hydrated (see generate-recommendations-form.tsx for the pattern).
// The <form> still works as a plain GET without JS; this adds a submit
// spinner plus an autosuggest dropdown (debounced request to suggestHref,
// its own loading state). Because the suggest endpoint already resolved a
// pick to an exact user id, selecting one goes straight to their profile
// rather than resubmitting the search — mirrors movie-search-form.tsx.
export const UserSearchForm = clientEntry<UserSearchFormProps>(
  import.meta.url,
  function UserSearchForm(handle) {
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
      window.location.href = handle.props.profileHrefTemplate.replace(
        PROFILE_HREF_PLACEHOLDER,
        encodeURIComponent(suggestion.key),
      )
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
              placeholder="Search by username…"
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
