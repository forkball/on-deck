import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ActiveTabScroller } from '../../browser/active-tab-scroller.tsx'

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
  // At the far end of the bar rather than after the tab before it — for a tab
  // that isn't one of a set, like a profile's Titles beside its media types.
  end?: boolean
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

// One line that scrolls sideways when the tabs outgrow a phone, rather than
// wrapping to a second row that reads as a second set of tabs. Shared with
// media-tab-links.tsx so the two bars behave alike.
//
// Vertical overflow is clipped, not scrolled: a tab's touch band (`tap-area`
// in app.css) reaches 8px past it top and bottom, and `overflow-x: auto` alone
// would make that a vertical scroll. The top padding, taken back by the
// negative margin, keeps the upper half of the band inside the clip; the lower
// half is given up, since padding there would lift the active underline off
// the bar's rule.
export const TAB_BAR_SCROLL = {
  display: 'flex',
  flexWrap: 'nowrap',
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': { display: 'none' },
  paddingTop: '8px',
  marginTop: '-8px',
  '& > *': { flexShrink: 0, whiteSpace: 'nowrap' },
} satisfies CSSStyle

// Base and active styles share one object: two css() calls land in two @layers
// ordered by declaration, not specificity, so a later base beats an earlier
// active override.
function tabsStyle(idPrefix: string, tabs: TabDefinition[]): CSSStyle {
  const style: Record<string, unknown> = {
    position: 'relative',
    marginTop: '40px',
    // Only the tab bar's own radios, which are direct children: a radio inside
    // a panel — the Titles tab's filter — is a real control and must show.
    '& > input[type="radio"]': {
      position: 'absolute',
      width: 0,
      height: 0,
      opacity: 0,
      pointerEvents: 'none',
    },
  }
  // The tab bar's own labels, picked out by what they point at, for the same
  // reason as the radios: labels inside a panel are the panel's business.
  style[`& label[for^="${idPrefix}-tab-"]`] = {
    cursor: 'pointer',
    padding: '0 0 8px',
    color: 'var(--muted)',
    borderBottom: '2px solid transparent',
  }

  for (const { id } of tabs) {
    style[`& .panel-${id}`] = { display: 'none' }
    style[`&:has(#${idPrefix}-tab-${id}:checked) .panel-${id}`] = { display: 'block' }
    style[`&:has(#${idPrefix}-tab-${id}:checked) label[for="${idPrefix}-tab-${id}"]`] = {
      color: 'var(--accent)',
      fontWeight: 700,
      borderBottomColor: 'var(--accent)',
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
      <div mix={css(tabsStyle(idPrefix, tabs))}>
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
            ...TAB_BAR_SCROLL,
            columnGap: 'clamp(12px, 4vw, 20px)',
            borderBottom: '1px solid var(--rule)',
            marginBottom: '16px',
          })}
        >
          {tabs.map((tab) => (
            <label
              key={tab.id}
              for={`${idPrefix}-tab-${tab.id}`}
              class="tap-area"
              mix={tab.end ? css({ marginLeft: 'auto' }) : undefined}
            >
              {tab.label}
            </label>
          ))}
          <ActiveTabScroller />
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
