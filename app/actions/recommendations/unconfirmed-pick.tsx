import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaType } from '../../data/mediaItems.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { ModelProvided } from './model-provided.tsx'
import type { UnmatchedPick } from '../../data/recommendations/unmatched.ts'

const REASON_NOTE =
  'Written by the model from the taste profile this run was built on. The catalog has no entry we could match, so nothing has checked it.'

// One look for every pick no catalog entry stands behind — the run page's
// "Also suggested" section, an unconfirmed run, an unconfirmed lucky draw — so the
// three can't drift apart the way they had, as a numbered list in two places and a
// card in the third.
//
// The confirmed pick's card with what can't be honest here taken out: no cover, no
// log button, no detail link, since each would imply a catalog entry. A search of
// the catalog stands in for them, for someone who wants to look it up themselves.
export function UnconfirmedPick(handle: Handle<{ pick: UnmatchedPick; mediaType: MediaType }>) {
  return () => {
    const { pick, mediaType } = handle.props
    const ui = mediaTypeUiFor(mediaType)

    return (
      <div mix={css({ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' })}>
        <span mix={css({ fontWeight: 700 })}>{pick.title}</span>
        {pick.year ? ` (${pick.year})` : ''}
        {pick.creator && <span mix={css({ color: '#555' })}> — {pick.creator}</span>}
        <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: '#555' })}>
          <ModelProvided note={REASON_NOTE}>{pick.reason}</ModelProvided>
        </p>
        <p mix={css({ margin: '8px 0 0', fontSize: '13px' })}>
          <a
            href={ui.catalogSearchUrl(pick.title, pick.year)}
            target="_blank"
            rel="noopener noreferrer"
            class="tap-area"
          >
            Search {ui.catalogName}
          </a>
        </p>
      </div>
    )
  }
}

// A stack of them, spaced as a run's confirmed picks are.
export function UnconfirmedPickList(handle: Handle<{ picks: UnmatchedPick[]; mediaType: MediaType }>) {
  return () => {
    const { picks, mediaType } = handle.props
    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: '16px 0 0',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        })}
      >
        {picks.map((pick) => (
          // Block, not list-item: Doodle puts its "* " marker on every li, and only a
          // list-item draws one — the confirmed picks' rows escape it by being flex.
          <li key={`${pick.title}-${pick.year}`} mix={css({ display: 'block' })}>
            <UnconfirmedPick pick={pick} mediaType={mediaType} />
          </li>
        ))}
      </ul>
    )
  }
}
