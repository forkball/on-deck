import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// Mirrors the media types offered in media-type-fab.tsx — only movies are
// wired up today, the rest are placeholders so this reads as "more coming"
// rather than movies being the only media type the app will ever support.
const OTHER_MEDIA_TYPES = ['tv', 'games', 'books', 'comics'] as const
const TYPES = ['movies', ...OTHER_MEDIA_TYPES] as const

function capitalize(type: string): string {
  return type === 'tv' ? 'TV' : type.replace(/^./, (c) => c.toUpperCase())
}

// Radio-driven CSS-only tabs (same no-JS approach as the rest of the app —
// see the star rating input and the watched-only-fields toggle in app.css).
// Each radio's `:checked` state is read via `:has()` on the wrapper to
// toggle both which panel shows and which tab label looks active, so no
// sibling-order constraints are needed between the tab bar and the panels.
type CSSStyle = Parameters<typeof css>[0]

// Label base + active-state overrides both live in this one style object
// (applied to the wrapper) rather than splitting the label's own look into
// a separate mix={css(...)} on the <label> itself — two different css()
// calls land in two different cascade @layers ordered by declaration order,
// not specificity, so a later-declared "base" layer would silently beat an
// earlier "active override" layer regardless of how specific its selector
// is. Keeping both in the same object keeps them in the same layer, where
// the more specific :has() selector reliably wins.
function tabsStyle(idPrefix: string): CSSStyle {
  const style: Record<string, unknown> = {
    position: 'relative',
    marginTop: '40px',
    '& input[type="radio"]': {
      position: 'absolute',
      width: 0,
      height: 0,
      opacity: 0,
      pointerEvents: 'none',
    },
    '& label': {
      cursor: 'pointer',
      padding: '0 0 8px',
      color: '#888',
      borderBottom: '2px solid transparent',
    },
  }

  for (const type of TYPES) {
    style[`& .panel-${type}`] = { display: 'none' }
    style[`&:has(#${idPrefix}-tab-${type}:checked) .panel-${type}`] = { display: 'block' }
    style[`&:has(#${idPrefix}-tab-${type}:checked) label[for="${idPrefix}-tab-${type}"]`] = {
      color: '#3c3c3c',
      fontWeight: 700,
      borderBottomColor: '#3c3c3c',
    }
  }

  return style as CSSStyle
}

export interface MediaTabsProps {
  // Distinguishes this instance's radio group/ids from any other MediaTabs
  // on the same page — not needed today (one per page), but cheap insurance.
  idPrefix: string
  // Content for the one media type with real data.
  children?: RemixNode
}

export function MediaTabs(handle: Handle<MediaTabsProps>) {
  return () => {
    const { idPrefix, children } = handle.props

    return (
      <div mix={css(tabsStyle(idPrefix))}>
        {TYPES.map((type, index) => (
          <input
            key={type}
            type="radio"
            name={`${idPrefix}-tab`}
            id={`${idPrefix}-tab-${type}`}
            defaultChecked={index === 0}
          />
        ))}

        <div
          mix={css({
            display: 'flex',
            gap: '20px',
            borderBottom: '1px solid #ddd',
            marginBottom: '16px',
          })}
        >
          {TYPES.map((type) => (
            <label key={type} for={`${idPrefix}-tab-${type}`}>
              {capitalize(type)}
            </label>
          ))}
        </div>

        <div class="panel-movies">{children}</div>
        {OTHER_MEDIA_TYPES.map((type) => (
          <div key={type} class={`panel-${type}`}>
            <p mix={css({ color: '#888' })}>{capitalize(type)} logging is coming soon.</p>
          </div>
        ))}
      </div>
    )
  }
}
