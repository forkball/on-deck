import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { Link } from '../shared/form-controls.tsx'
import { TAB_BAR_SCROLL } from './tabs.tsx'

const PLACEHOLDER_TYPES: string[] = []

export interface MediaTabLinksProps {
  // A media type, or 'people' on the people search the bar also leads to.
  current: ActiveMediaType | 'people'
  // A callback rather than fixed per-type props, so callers can preserve their
  // own query string across the switch.
  hrefFor: (type: ActiveMediaType) => string
  // Given, a People tab at the far end of the bar: the search pages offer
  // finding people beside finding things, so the two are one Search in the nav.
  peopleHref?: string
  // The viewer's order for the media types (parseMediaOrder); the registry's
  // when not given.
  order?: readonly ActiveMediaType[]
}

// The navigation counterpart to media-tabs.tsx, which can toggle in CSS because
// both its panels are server-rendered together. Search content genuinely
// differs per type, so these are links that fetch the other type's page.
//
// `rmx-document` is load-bearing: without it the framework does a client-side
// frame reload, swapping the DOM but leaving hydrated client entries holding
// their original props, so the TV search page would fire /movies/suggest.
export function MediaTabLinks(handle: Handle<MediaTabLinksProps>) {
  return () => {
    const { current, hrefFor, peopleHref, order = ACTIVE_MEDIA_TYPES } = handle.props

    // Colour and weight are in public/app.css (`a.media-tab`): `.doodle a` is
    // unlayered, so a css() colour here is dropped.
    const tab = css({ padding: '0 0 8px', borderBottom: '2px solid transparent' })

    return (
      <div
        mix={css({
          ...TAB_BAR_SCROLL,
          gap: '20px',
          borderBottom: '1px solid var(--rule)',
          // 20px from what's above, less the 8px of padding the scroll adds.
          marginTop: '12px',
          marginBottom: '20px',
        })}
      >
        {order.map((type) => (
          <Link
            key={type}
            href={hrefFor(type)}
            rmx-document=""
            variant="tab"
            tapArea
            aria-current={current === type ? 'page' : undefined}
            mix={tab}
          >
            {MEDIA_TYPE_UI[type].tabLabel}
          </Link>
        ))}
        {peopleHref && (
          <Link
            href={peopleHref}
            rmx-document=""
            variant="tab"
            tapArea
            aria-current={current === 'people' ? 'page' : undefined}
            mix={[tab, css({ marginLeft: 'auto' })]}
          >
            People
          </Link>
        )}
        {PLACEHOLDER_TYPES.map((label) => (
          <span key={label} mix={css({ padding: '0 0 8px', color: 'var(--rule)' })} title="Coming soon">
            {label}
          </span>
        ))}
      </div>
    )
  }
}
