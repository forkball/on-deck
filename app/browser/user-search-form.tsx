import { clientEntry, css, on, ref } from 'remix/ui'

import { SuggestionDropdown } from './shared/suggestion-dropdown.tsx'
import { Spinner } from './shared/spinner.tsx'
import {
  createSuggestionFetcher,
  EMPTY_SUGGEST_STATE,
  type SuggestState,
  type Suggestion,
} from './shared/suggestions.ts'
import { Button, TextInput } from '../ui/shared/form-controls.tsx'
import { Field } from '../ui/shared/field.tsx'

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
            // Stacked, input over a full-width button, like the media searches'
            // form (movie-search-form.tsx), so switching tabs doesn't move it.
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
            <Field label="Search people" labelHidden>
              <TextInput
                name="q"
                value={query}
                autocomplete="off"
                placeholder="Search for a person…"
                mix={[
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
            </Field>
            {suggestState.open && <SuggestionDropdown state={suggestState} onSelect={selectSuggestion} />}
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            mix={css({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' })}
          >
            {submitting && <Spinner />}
            {submitting ? 'Searching…' : 'Search'}
          </Button>
        </form>
      )
    }
  },
)
