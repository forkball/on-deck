import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

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

    const tab = css({
      padding: '0 0 8px',
      textDecoration: 'none',
      color: '#888',
      borderBottom: '2px solid transparent',
    })
    const activeTab = css({
      padding: '0 0 8px',
      textDecoration: 'none',
      color: '#3c3c3c',
      fontWeight: 700,
      borderBottom: '2px solid #3c3c3c',
    })

    return (
      <div
        mix={css({
          display: 'flex',
          gap: '20px',
          borderBottom: '1px solid #ddd',
          marginTop: '20px',
          marginBottom: '20px',
        })}
      >
        {ACTIVE_MEDIA_TYPES.map((type) => (
          <a key={type} href={hrefFor(type)} rmx-document="" mix={current === type ? activeTab : tab}>
            {MEDIA_TYPE_UI[type].tabLabel}
          </a>
        ))}
        {PLACEHOLDER_TYPES.map((label) => (
          <span key={label} mix={css({ padding: '0 0 8px', color: '#ccc' })} title="Coming soon">
            {label}
          </span>
        ))}
      </div>
    )
  }
}
