import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Page } from '../../ui/components/page.tsx'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { ModelProvided } from './model-provided.tsx'
import { routes } from '../../routes.ts'
import type { UnconfirmedRunDetail } from '../../data/recommendations/unconfirmed.ts'
import { LUCKY_RUN_NAME } from '../../data/recommendations/lucky.ts'

export interface UnconfirmedRunPageProps {
  run: UnconfirmedRunDetail
  displayName: string
}

// What the model said when the catalog couldn't be reached.
//
// Deliberately not the recommendation card: no cover, no log button, no link
// through to a detail page, because there is no catalog entry behind any of this
// and every one of those controls would imply there was. A title, a year and the
// reason it was picked is the whole of what we actually have.
export function UnconfirmedRunPage(handle: Handle<UnconfirmedRunPageProps>) {
  return () => {
    const { run, displayName } = handle.props
    const noun = mediaTypeUiFor(run.mediaType).plural
    const date = new Date(run.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

    // A lucky draw reads as the lucky pick it stands in for: the name, the date and
    // the one pick with the model's description, laid out as a lucky run lays out
    // its pick. Still no cover, log button or detail link — there is no catalog
    // entry behind it, and those would imply one.
    if (run.isLucky) {
      const [pick] = run.picks
      return (
        <Page
          heading={LUCKY_RUN_NAME}
          back={{ href: routes.recommendations.index.href(), label: '← Recommendations' }}
          width="wide"
          displayName={displayName}
        >
          <p mix={css({ color: '#555' })}>{date}</p>
          {pick && (
            <div
              mix={css({
                marginTop: '24px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '16px',
              })}
            >
              <span mix={css({ fontWeight: 700 })}>{pick.title}</span>
              {pick.year ? ` (${pick.year})` : ''}
              <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: '#555' })}>
                <ModelProvided note="Written by the model from the taste profile this run was built on — not a description from the catalogue.">
                  {pick.reason}
                </ModelProvided>
              </p>
            </div>
          )}
          <p mix={css({ margin: '12px 0 0', color: '#888', fontSize: '13px' })}>
            We couldn't match this to {mediaTypeUiFor(run.mediaType).catalogName}, so it can't be logged from
            here.
          </p>
        </Page>
      )
    }

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
        <p mix={css({ margin: '8px 0 0', color: '#888', fontSize: '13px' })} title={run.reason}>
          {date} · The catalog couldn't be reached, so these are the model's picks, unchecked. They can't be
          logged from here.
        </p>

        <ol
          mix={css({
            margin: '16px 0 0',
            padding: '0 0 0 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          })}
        >
          {run.picks.map((pick) => (
            <li key={`${pick.title}-${pick.year}`}>
              <span mix={css({ fontWeight: 700 })}>{pick.title}</span>
              {pick.year ? ` (${pick.year})` : ''}
              <p mix={css({ margin: '4px 0 0', fontStyle: 'italic', color: '#555' })}>
                <ModelProvided note="Written by the model from the taste profile this run was built on — not a description from the catalogue.">
                  {pick.reason}
                </ModelProvided>
              </p>
            </li>
          ))}
        </ol>

        <p mix={css({ marginTop: '24px' })}>
          <a href={routes.recommendations.index.href()}>Generate a new run</a>
        </p>
      </Page>
    )
  }
}
