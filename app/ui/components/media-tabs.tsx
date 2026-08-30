import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

// Mirrors media-tab-links.tsx.
const PLACEHOLDER_MEDIA_TYPES = [] as const

// The registry's `slug` reconciles plural route segments with singular
// MediaType, and keeps rendered ids stable.
const ACTIVE_SLUGS = ACTIVE_MEDIA_TYPES.map((type) => MEDIA_TYPE_UI[type].slug)
const TYPES = [...ACTIVE_SLUGS, ...PLACEHOLDER_MEDIA_TYPES]

function capitalize(type: string): string {
  return type === 'tv' ? 'TV' : type.replace(/^./, (c) => c.toUpperCase())
}

// Radio-driven CSS-only tabs: `:has()` on the wrapper reads each radio's
// `:checked`, so the bar and panels need no sibling-order relationship.
type CSSStyle = Parameters<typeof css>[0]

// Base and active styles share one object: two css() calls land in two @layers
// ordered by declaration, not specificity, so a later base beats an earlier
// active override.
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
  // Distinguishes this instance's radio group from any other on the page.
  idPrefix: string
  // Keyed by MediaType, so adding a type is a registry edit, not a prop edit.
  panels: Partial<Record<ActiveMediaType, RemixNode>>
  // Without this the tabs have no URL representation, so returning from a
  // detail page always lands on the first one.
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
