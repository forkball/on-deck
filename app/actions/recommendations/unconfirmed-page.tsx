import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Page } from '../../ui/components/page.tsx'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { UnconfirmedPick, UnconfirmedPickList } from './unconfirmed-pick.tsx'
import { routes } from '../../routes.ts'
import type { UnconfirmedRunDetail } from '../../data/recommendations/unconfirmed.ts'
import { LUCKY_RUN_NAME } from '../../data/recommendations/lucky.ts'

export interface UnconfirmedRunPageProps {
  run: UnconfirmedRunDetail
  displayName: string
}

// What the model said when the catalog couldn't be reached. The picks are drawn as
// UnconfirmedPick, which says why they carry no cover, log button or detail link.
export function UnconfirmedRunPage(handle: Handle<UnconfirmedRunPageProps>) {
  return () => {
    const { run, displayName } = handle.props
    const date = new Date(run.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

    // A lucky draw reads as the lucky pick it stands in for: its name, the date and
    // the one pick.
    if (run.isLucky) {
      const [pick] = run.picks
      return (
        <Page
          heading={LUCKY_RUN_NAME}
          back={{ href: routes.recommendations.index.href(), label: '← Recommendations' }}
          width="wide"
          displayName={displayName}
        >
          <p mix={css({ color: 'var(--soft)' })}>{date}</p>
          {pick && (
            <div mix={css({ marginTop: '24px' })}>
              <UnconfirmedPick pick={pick} mediaType={run.mediaType} />
            </div>
          )}
          <p mix={css({ margin: '12px 0 0', color: 'var(--muted)', fontSize: '13px' })}>
            We couldn't match this to {mediaTypeUiFor(run.mediaType).catalogName}, so it can't be logged from
            here.
          </p>
        </Page>
      )
    }

    const noun = mediaTypeUiFor(run.mediaType).plural
    return (
      <Page
        title={`Unconfirmed ${noun}`}
        heading="Suggested, but not confirmed"
        back={{ href: routes.recommendations.index.href(), label: '← Recommendations' }}
        width="wide"
        displayName={displayName}
      >
        {/* One quiet line rather than a warning box: the heading already says these
            are unconfirmed, and the page has nothing to act on but the list. The
            stage that failed is kept as the tooltip, for whoever needs it. */}
        <p mix={css({ margin: '8px 0 0', color: 'var(--muted)', fontSize: '13px' })} title={run.reason}>
          {date} · The catalog couldn't be reached, so these are the model's picks, unchecked. They can't be
          logged from here.
        </p>

        <UnconfirmedPickList picks={run.picks} mediaType={run.mediaType} />

        <p mix={css({ marginTop: '24px' })}>
          <a href={routes.recommendations.index.href()}>Generate a new run</a>
        </p>
      </Page>
    )
  }
}
