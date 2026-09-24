import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Document } from '../../ui/components/document.tsx'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { ModelProvided } from './model-provided.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { routes } from '../../routes.ts'
import type { UnconfirmedRunDetail } from '../../data/recommendations/unconfirmed.ts'

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

    return (
      <Document title={`Unconfirmed ${noun} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <p mix={css({ margin: '0 0 16px' })}>
            <a href={routes.recommendations.index.href()}>← Recommendations</a>
          </p>
          <h1>Suggested, but not confirmed</h1>

          <div
            mix={css({
              border: '1px solid #f0c36d',
              background: '#fdf6e3',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '16px 0 24px',
            })}
          >
            <p mix={css({ margin: 0 })}>{run.reason}</p>
            <p mix={css({ margin: '8px 0 0', fontSize: '13px', color: '#555' })}>
              These are the model's own suggestions, kept so the run wasn't wasted. Nothing has checked that
              they exist, that the years are right, or that you haven't already logged them — so they can't be
              added to your log from here. Generating again once the catalog is back will produce a real run.
            </p>
          </div>

          <p mix={css({ color: '#888', fontSize: '13px' })}>{date}</p>

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
        </main>
      </Document>
    )
  }
}
