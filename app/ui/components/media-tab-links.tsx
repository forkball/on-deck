import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../utils/mediaTypes.ts'

// Only movies and TV are wired up — the rest match the placeholders shown
// in media-tabs.tsx (the profile page's tabs) so the two read the same.
const PLACEHOLDER_TYPES = ['Games', 'Comics']

export interface MediaTabLinksProps {
  current: ActiveMediaType
  // Builds the link for each wired-up type. A callback rather than fixed
  // movieHref/tvHref props because callers need to preserve their own query
  // string (?q=, ?mediaType=) across the switch.
  hrefFor: (type: ActiveMediaType) => string
}

// The navigation counterpart to media-tabs.tsx: that one is a CSS-only
// radio toggle (both panels are server-rendered in the same response, so
// switching is free), but search/recommendations content genuinely differs
// per type — different TMDB endpoint, different genre list — so these tabs
// are links that fetch the other type's page.
//
// `rmx-document` is load-bearing, not decoration: without it the framework
// intercepts the click and does a client-side frame reload, which swaps the
// visible DOM but leaves already-hydrated islands holding their original
// props. That's what made the TV search page fire /movies/suggest and show
// movie titles in its autosuggest — the page said "Search TV" while the
// hydrated search form was still the movie one. Forcing a real document
// navigation re-hydrates everything against the new page.
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
