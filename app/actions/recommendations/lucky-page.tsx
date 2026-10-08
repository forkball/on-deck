import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LuckyState } from '../../data/recommendations/lucky.ts'
import { routes } from '../../routes.ts'
import { Page } from '../../ui/components/page.tsx'
import { ErrorNotice, type ErrorLink } from './error-notice.tsx'
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
  errorLink?: ErrorLink
}

// The dedicated home for the "🎲 Draw today's pick" call to action, so it
// skips the general recommendations page's shortlist-only questions.
export function LuckyPickPage(handle: Handle<LuckyPickPageProps>) {
  return () => {
    const { friends, viewerLoggedTypes, mediaType, lucky, displayName, findPeopleHref, error, errorLink } =
      handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const luckyPageHref = routes.recommendations.luckyPage.href()

    return (
      <Page title="Today's lucky pick" heading="🎲 Today's lucky pick" displayName={displayName}>
        <p mix={css({ margin: 0, color: '#555' })}>
          One thing to watch, read or play — no filters, nothing to decide.
        </p>

        <MediaTabLinks current={mediaType} hrefFor={(type) => `${luckyPageHref}?mediaType=${type}`} />

        {error && <ErrorNotice error={error} link={errorLink} />}

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
