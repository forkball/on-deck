// A plain module, not a component, so more than one clientEntry can use it
// without nesting hydrated client entries.

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
  // Debounces, cancels any in-flight request, and reports transitions via
  // onChange.
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
