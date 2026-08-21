import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import type { LuckyPick } from '../../data/recommendations/lucky.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { routes } from '../../routes.ts'

// The day's pick, rendered the same on the landing page, the profile and the
// recommendations page. It lives in ui/components rather than beside one of
// them because all three show it and none of them owns it — see AGENTS.md.
export interface LuckyPickCardProps {
  pick: LuckyPick
  // Where the "back" link on the media page should return to. The three places
  // this appears are three different answers.
  returnTo: string
  // The landing page and the profile lead with it; the recommendations page has
  // already said what it is in the panel around it.
  heading?: string
}

export function LuckyPickCard(handle: Handle<LuckyPickCardProps>) {
  return () => {
    const { pick, returnTo, heading } = handle.props
    const { releaseYear, posterUrl } = parseMediaMetadata(pick.metadata)
    const ui = mediaTypeUiFor(pick.mediaType)
    const runHref = routes.recommendations.show.href({ runId: String(pick.runId) })
    const detailHref = `${ui.hrefs.show(pick.mediaItemId)}?from=${encodeURIComponent(returnTo)}`

    return (
      <div
        mix={css({
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          gap: '14px',
        })}
      >
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
          {heading && (
            <p mix={css({ margin: '0 0 6px', fontSize: '12px', letterSpacing: '0.04em', color: '#888' })}>
              {heading}
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
          <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#888' })}>
            {pick.otherMemberLabels.length > 0
              ? `Drawn for you + ${pick.otherMemberLabels.join(', ')} — none of you had logged it.`
              : `Nothing you'd logged.`}{' '}
            <a href={runHref}>See the pick →</a>
          </p>
        </div>
      </div>
    )
  }
}
