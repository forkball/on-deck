import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// Radio-driven CSS-only tabs: `:has()` on the wrapper reads each radio's
// `:checked`, so the bar and the panels need no sibling-order relationship and
// nothing has to run in the browser to switch between them.
//
// Every panel is in the document either way, which is what makes this suitable
// for tabs over content that is already all server-rendered — and unsuitable
// for tabs over content that isn't. Where the panes genuinely differ per page,
// they should be links that fetch it: see media-tab-links.tsx.
//
// Extracted from media-tabs.tsx, which now renders through this and keeps only
// what is specific to media types. The technique is fiddly enough — the
// selector construction, the single-object styling below — that having two of
// it would mean fixing anything twice.
type CSSStyle = Parameters<typeof css>[0]

export interface TabDefinition {
  // Appears in the DOM as part of an id, so it has to be selector-safe.
  id: string
  label: string
  panel: RemixNode
}

export interface TabsProps {
  // Distinguishes this instance's radio group from any other on the page.
  idPrefix: string
  tabs: TabDefinition[]
  // Without this the tabs have no URL representation, so anything that
  // redirects back to the page always lands on the first one. Falls back to
  // the first tab when absent or unrecognised.
  active?: string
}

// Base and active styles share one object: two css() calls land in two @layers
// ordered by declaration, not specificity, so a later base beats an earlier
// active override.
function tabsStyle(idPrefix: string, ids: string[]): CSSStyle {
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

  for (const id of ids) {
    style[`& .panel-${id}`] = { display: 'none' }
    style[`&:has(#${idPrefix}-tab-${id}:checked) .panel-${id}`] = { display: 'block' }
    style[`&:has(#${idPrefix}-tab-${id}:checked) label[for="${idPrefix}-tab-${id}"]`] = {
      color: '#3c3c3c',
      fontWeight: 700,
      borderBottomColor: '#3c3c3c',
    }
  }

  return style as CSSStyle
}

export function Tabs(handle: Handle<TabsProps>) {
  return () => {
    const { idPrefix, tabs, active } = handle.props
    const ids = tabs.map((tab) => tab.id)
    // An unrecognised `active` falls back rather than leaving every radio
    // unchecked, which would render a tab bar over nothing at all.
    const activeId = active && ids.includes(active) ? active : ids[0]

    return (
      <div mix={css(tabsStyle(idPrefix, ids))}>
        {tabs.map((tab) => (
          <input
            key={tab.id}
            type="radio"
            name={`${idPrefix}-tab`}
            id={`${idPrefix}-tab-${tab.id}`}
            defaultChecked={tab.id === activeId}
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
          {tabs.map((tab) => (
            <label key={tab.id} for={`${idPrefix}-tab-${tab.id}`}>
              {tab.label}
            </label>
          ))}
        </div>

        {tabs.map((tab) => (
          <div key={tab.id} class={`panel-${tab.id}`}>
            {tab.panel}
          </div>
        ))}
      </div>
    )
  }
}
