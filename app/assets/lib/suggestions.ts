// Shared by the movie and "find people" autosuggest inputs. Plain module
// (no JSX/components), so it can be imported by more than one clientEntry
// file without running into the "one hydrated island can't nest another"
// question — each form hydrates itself and just uses this for its fetch
// state machine.

export type Suggestion = {
  key: string
  label: string
  sublabel?: string
  imageUrl?: string
}

export type SuggestState = {
  suggestions: Suggestion[]
  loading: boolean
  open: boolean
}

export const EMPTY_SUGGEST_STATE: SuggestState = { suggestions: [], loading: false, open: false }

export interface SuggestionFetcher {
  // Called on every keystroke. Debounces, cancels any still-in-flight
  // request, and reports state transitions (opening the dropdown with a
  // loading spinner, then swapping in results) via onChange.
  query(value: string): void
}

export function createSuggestionFetcher(options: {
  suggestHref: string
  signal: AbortSignal
  onChange: (state: SuggestState) => void
  minLength?: number
  debounceMs?: number
}): SuggestionFetcher {
  const { suggestHref, signal, onChange, minLength = 2, debounceMs = 250 } = options

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let abortController: AbortController | undefined

  signal.addEventListener('abort', () => {
    clearTimeout(debounceTimer)
    abortController?.abort()
  })

  return {
    query(value: string) {
      clearTimeout(debounceTimer)
      abortController?.abort()

      const trimmed = value.trim()
      if (trimmed.length < minLength) {
        onChange(EMPTY_SUGGEST_STATE)
        return
      }

      onChange({ suggestions: [], loading: true, open: true })

      debounceTimer = setTimeout(() => {
        const controller = new AbortController()
        abortController = controller

        fetch(`${suggestHref}?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error(`Suggest request failed: ${response.status}`)
            return response.json() as Promise<{ suggestions: Suggestion[] }>
          })
          .then((data) => {
            onChange({ suggestions: data.suggestions, loading: false, open: true })
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return
            onChange({ suggestions: [], loading: false, open: true })
          })
      }, debounceMs)
    },
  }
}
