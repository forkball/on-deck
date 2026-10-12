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
  // Tabs after the media types that aren't one — a profile's Titles tab.
  extraTabs?: TabDefinition[]
  // Without this the tabs have no URL representation, so returning from a
  // detail page always lands on the first one. A media type, or the id of one
  // of `extraTabs`.
  active?: ActiveMediaType | string
}

// The media-type reading of Tabs: the registry decides which tabs exist and
// what they are called, and the CSS-only switching lives in tabs.tsx.
//
// The registry's `slug` reconciles plural route segments with singular
// MediaType, and keeps rendered ids stable.
export function MediaTabs(handle: Handle<MediaTabsProps>) {
  return () => {
    const { idPrefix, panels, extraTabs = [], active } = handle.props

    const tabs: TabDefinition[] = [
      ...ACTIVE_MEDIA_TYPES.map((type) => ({
        id: MEDIA_TYPE_UI[type].slug,
        label: capitalize(MEDIA_TYPE_UI[type].slug),
        // A wired-up media type whose caller hasn't supplied a panel would
        // otherwise render as a blank tab, which reads as broken rather than
        // unfinished.
        panel: panels[type] ?? <p mix={css({ color: 'var(--muted)' })}>Nothing to show here yet.</p>,
      })),
      ...PLACEHOLDER_MEDIA_TYPES.map((type) => ({
        id: type,
        label: capitalize(type),
        panel: <p mix={css({ color: 'var(--muted)' })}>{capitalize(type)} logging is coming soon.</p>,
      })),
      ...extraTabs,
    ]
    const activeId =
      active && active in MEDIA_TYPE_UI ? MEDIA_TYPE_UI[active as ActiveMediaType].slug : active

    return <Tabs idPrefix={idPrefix} tabs={tabs} active={activeId} />
  }
}
