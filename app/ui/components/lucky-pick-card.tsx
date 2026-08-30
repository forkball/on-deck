import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import type { LuckyPick } from '../../data/recommendations/lucky.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { withReturnTo } from '../backLink.ts'

// What the day's pick is called, wherever it is named. Exported because the
// home page heads its own column with it (see showLabel) and two copies of the
// words would drift.
export const LUCKY_PICK_LABEL = "Today's lucky pick"

// The box the pick sits in, exported because the home page renders a call to
// action in the same slot when nothing has been drawn — the two have to be the
// same box, or the empty state visibly steps out of the filled one.
export const LUCKY_CARD_BOX = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '16px',
} as const

// The day's pick, rendered the same on the landing page and the profile. It
// lives in ui/components rather than beside one of them because both show it
// and neither owns it — see AGENTS.md.
export interface LuckyPickCardProps {
  pick: LuckyPick
  // Where the "back" link on the media page should return to. Each place this
  // appears is a different answer.
  returnTo: string
  // The card names itself by default. The home page turns that off because it
  // heads the column the card sits in — the label is still on screen, once,
  // above the card rather than inside it.
  showLabel?: boolean
}

export function LuckyPickCard(handle: Handle<LuckyPickCardProps>) {
  return () => {
    const { pick, returnTo, showLabel = true } = handle.props
    const { releaseYear, posterUrl } = parseMediaMetadata(pick.metadata)
    const ui = mediaTypeUiFor(pick.mediaType)
    const detailHref = withReturnTo(ui.hrefs.show(pick.mediaItemId), returnTo)

    return (
      <div mix={css({ ...LUCKY_CARD_BOX, display: 'flex', gap: '14px' })}>
        {posterUrl ? (
          <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
            <img
              src={posterUrl}
              alt={`${pick.title} poster`}
              mix={css({ width: '72px', borderRadius: '4px', display: 'block' })}
            />
          </a>
        ) : (
          <div
            mix={css({
              width: '72px',
              height: '108px',
              flex: '0 0 auto',
              border: '1px solid #ddd',
              borderRadius: '4px',
            })}
          />
        )}
        <div mix={css({ flex: '1 1 auto', minWidth: 0 })}>
          {showLabel && (
            <p mix={css({ margin: '0 0 6px', fontSize: '12px', letterSpacing: '0.04em', color: '#888' })}>
              {LUCKY_PICK_LABEL}
            </p>
          )}
          <p mix={css({ margin: 0 })}>
            <a href={detailHref} mix={css({ fontWeight: 700 })}>
              {pick.title}
            </a>
            {releaseYear ? ` (${releaseYear})` : ''}{' '}
            <span mix={css({ color: '#888', fontSize: '13px' })}>· {ui.singular}</span>
          </p>
          <p mix={css({ margin: '6px 0 0', color: '#555' })}>{pick.reason}</p>
        </div>
      </div>
    )
  }
}
