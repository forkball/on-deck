import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../utils/mediaTypes.ts'

// Mirrors the media types offered in media-tab-links.tsx — movies and TV are
// wired up, the rest are placeholders so this reads as "more coming" rather
// than movies+TV being the only media types the app will ever support.
const PLACEHOLDER_MEDIA_TYPES = [] as const

// Slugs are plural ('movies') while MediaType is singular ('movie') — the
// registry's `slug` is the single place that mismatch is reconciled, and
// using it here keeps the rendered ids/class names stable.
const ACTIVE_SLUGS = ACTIVE_MEDIA_TYPES.map((type) => MEDIA_TYPE_UI[type].slug)
const TYPES = [...ACTIVE_SLUGS, ...PLACEHOLDER_MEDIA_TYPES]

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
  // One entry per wired-up media type. Keyed by MediaType rather than fixed
  // `movies`/`tv` slots so adding a type is a registry edit, not a prop edit.
  panels: Partial<Record<ActiveMediaType, RemixNode>>
  // Which tab opens selected. Without this the tabs are pure CSS state with
  // no URL representation, so returning from a detail page always dumped you
  // back on the first tab regardless of where you'd been.
  active?: ActiveMediaType
}

export function MediaTabs(handle: Handle<MediaTabsProps>) {
  return () => {
    const { idPrefix, panels, active } = handle.props
    const activeSlug = active ? MEDIA_TYPE_UI[active].slug : ACTIVE_SLUGS[0]

    return (
      <div mix={css(tabsStyle(idPrefix))}>
        {TYPES.map((type) => (
          <input
            key={type}
            type="radio"
            name={`${idPrefix}-tab`}
            id={`${idPrefix}-tab-${type}`}
            defaultChecked={type === activeSlug}
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

        {ACTIVE_MEDIA_TYPES.map((type) => (
          <div key={type} class={`panel-${MEDIA_TYPE_UI[type].slug}`}>
            {/* A wired-up media type whose caller hasn't supplied a panel
                would otherwise render as a blank tab, which reads as broken
                rather than unfinished. */}
            {panels[type] ?? (
              <p mix={css({ color: '#888' })}>Nothing to show here yet.</p>
            )}
          </div>
        ))}
        {PLACEHOLDER_MEDIA_TYPES.map((type) => (
          <div key={type} class={`panel-${type}`}>
            <p mix={css({ color: '#888' })}>{capitalize(type)} logging is coming soon.</p>
          </div>
        ))}
      </div>
    )
  }
}
