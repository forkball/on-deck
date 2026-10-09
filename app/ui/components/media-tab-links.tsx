import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { Link } from '../shared/form-controls.tsx'

const PLACEHOLDER_TYPES: string[] = []

export interface MediaTabLinksProps {
  current: ActiveMediaType
  // A callback rather than fixed per-type props, so callers can preserve their
  // own query string across the switch.
  hrefFor: (type: ActiveMediaType) => string
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
    const { current, hrefFor } = handle.props

    // Colour and weight are in public/app.css (`a.media-tab`): `.doodle a` is
    // unlayered, so a css() colour here is dropped. What this sets is the
    // type's hue, which that rule reads for the current tab.
    const tab = (type: ActiveMediaType) =>
      css({
        padding: '0 0 8px',
        borderBottom: '2px solid transparent',
        '--tab-hue': MEDIA_TYPE_UI[type].hue,
      })

    return (
      <div
        mix={css({
          display: 'flex',
          gap: '20px',
          borderBottom: '1px solid var(--rule)',
          marginTop: '20px',
          marginBottom: '20px',
        })}
      >
        {ACTIVE_MEDIA_TYPES.map((type) => (
          <Link
            key={type}
            href={hrefFor(type)}
            rmx-document=""
            variant="tab"
            tapArea
            aria-current={current === type ? 'page' : undefined}
            mix={tab(type)}
          >
            {MEDIA_TYPE_UI[type].tabLabel}
          </Link>
        ))}
        {PLACEHOLDER_TYPES.map((label) => (
          <span key={label} mix={css({ padding: '0 0 8px', color: 'var(--rule)' })} title="Coming soon">
            {label}
          </span>
        ))}
      </div>
    )
  }
}
