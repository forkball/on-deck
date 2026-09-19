import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { Tabs, type TabDefinition } from './tabs.tsx'

// Mirrors media-tab-links.tsx.
const PLACEHOLDER_MEDIA_TYPES = [] as const

function capitalize(type: string): string {
  return type === 'tv' ? 'TV' : type.replace(/^./, (c) => c.toUpperCase())
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

// The media-type reading of Tabs: the registry decides which tabs exist and
// what they are called, and the CSS-only switching lives in tabs.tsx.
//
// The registry's `slug` reconciles plural route segments with singular
// MediaType, and keeps rendered ids stable.
export function MediaTabs(handle: Handle<MediaTabsProps>) {
  return () => {
    const { idPrefix, panels, active } = handle.props

    const tabs: TabDefinition[] = [
      ...ACTIVE_MEDIA_TYPES.map((type) => ({
        id: MEDIA_TYPE_UI[type].slug,
        label: capitalize(MEDIA_TYPE_UI[type].slug),
        // A wired-up media type whose caller hasn't supplied a panel would
        // otherwise render as a blank tab, which reads as broken rather than
        // unfinished.
        panel: panels[type] ?? <p mix={css({ color: '#888' })}>Nothing to show here yet.</p>,
      })),
      ...PLACEHOLDER_MEDIA_TYPES.map((type) => ({
        id: type,
        label: capitalize(type),
        panel: <p mix={css({ color: '#888' })}>{capitalize(type)} logging is coming soon.</p>,
      })),
    ]

    return <Tabs idPrefix={idPrefix} tabs={tabs} active={active ? MEDIA_TYPE_UI[active].slug : undefined} />
  }
}
