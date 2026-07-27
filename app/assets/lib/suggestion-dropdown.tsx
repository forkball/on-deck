import type { Handle } from 'remix/ui'
import { css, on } from 'remix/ui'

import type { SuggestState, Suggestion } from './suggestions.ts'

// Rendered inside the two autosuggest forms (movie-search-form.tsx,
// user-search-form.tsx) — a plain nested component, not its own hydration
// root, so it can freely take a function prop (onSelect) despite living
// under a clientEntry boundary that otherwise only accepts serializable
// props at its own root.
export function SuggestionDropdown(
  handle: Handle<{ state: SuggestState; onSelect: (suggestion: Suggestion) => void }>,
) {
  return () => {
    const { state, onSelect } = handle.props

    return (
      <div
        class="suggestion-dropdown"
        mix={css({
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 20,
          backgroundColor: '#fdf7f1',
          border: '1px solid #3c3c3c',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          maxHeight: '320px',
          overflowY: 'auto',
        })}
      >
        {state.loading ? (
          <div
            mix={css({
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              color: '#888',
              fontSize: '13px',
            })}
          >
            <span
              aria-hidden="true"
              mix={css({
                '@keyframes suggestion-spin': {
                  from: { transform: 'rotate(0deg)' },
                  to: { transform: 'rotate(360deg)' },
                },
                display: 'inline-block',
                width: '13px',
                height: '13px',
                borderRadius: '50%',
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                animation: 'suggestion-spin 0.6s linear infinite',
              })}
            />
            Searching…
          </div>
        ) : state.suggestions.length === 0 ? (
          <div mix={css({ padding: '12px', color: '#888', fontSize: '13px' })}>No matches.</div>
        ) : (
          state.suggestions.map((suggestion) => (
            <button
              key={suggestion.key}
              type="button"
              mix={[
                css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.06)' },
                }),
                on('click', () => onSelect(suggestion)),
              ]}
            >
              {suggestion.imageUrl && (
                <img
                  src={suggestion.imageUrl}
                  alt=""
                  mix={css({
                    width: '28px',
                    height: '42px',
                    objectFit: 'cover',
                    borderRadius: '3px',
                    flex: '0 0 auto',
                  })}
                />
              )}
              <span mix={css({ flex: '1 1 auto', minWidth: 0 })}>
                {suggestion.label}
                {suggestion.sublabel && (
                  <span mix={css({ marginLeft: '6px', fontSize: '12px', color: '#888' })}>
                    {suggestion.sublabel}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    )
  }
}
