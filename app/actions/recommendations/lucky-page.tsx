import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LuckyState } from '../../data/recommendations/lucky.ts'
import { routes } from '../../routes.ts'
import { Page } from '../../ui/components/page.tsx'
import { MediaTabLinks } from '../../ui/components/media-tab-links.tsx'
import { DrawLuckyForm } from '../../browser/draw-lucky-form.tsx'
import type { FriendOption } from '../../browser/friend-picker.tsx'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

export interface LuckyPickPageProps {
  friends: FriendOption[]
  viewerLoggedTypes: string[]
  mediaType: ActiveMediaType
  lucky: LuckyState
  displayName: string
  findPeopleHref: string
  error?: string
}

// The dedicated home for the "🎲 Draw today's pick" call to action, so it
// skips the general recommendations page's shortlist-only questions.
export function LuckyPickPage(handle: Handle<LuckyPickPageProps>) {
  return () => {
    const { friends, viewerLoggedTypes, mediaType, lucky, displayName, findPeopleHref, error } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const luckyPageHref = routes.recommendations.luckyPage.href()

    return (
      <Page title="Today's lucky pick" heading="🎲 Today's lucky pick" displayName={displayName}>
        <p mix={css({ margin: 0, color: '#555' })}>
          One thing to watch, read or play — no filters, nothing to decide.
        </p>

        <MediaTabLinks current={mediaType} hrefFor={(type) => `${luckyPageHref}?mediaType=${type}`} />

        {error && (
          <p
            mix={css({
              margin: '0 0 16px',
              padding: '12px 16px',
              border: '1px solid #b91c1c',
              borderRadius: '8px',
              color: '#b91c1c',
            })}
          >
            {error}
          </p>
        )}

        {lucky.pick ? (
          <p mix={css({ margin: 0, color: '#555' })}>
            You've already drawn today's pick —{' '}
            <a href={routes.recommendations.show.href({ runId: String(lucky.pick.runId) })}>take a look</a>.
          </p>
        ) : (
          <DrawLuckyForm
            friends={friends}
            viewerLoggedTypes={viewerLoggedTypes}
            mediaType={mediaType}
            itemNoun={ui.plural}
            drawHref={routes.recommendations.lucky.href()}
            findPeopleHref={findPeopleHref}
          />
        )}
      </Page>
    )
  }
}
