import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ImportProgress } from '../../../browser/import-progress.tsx'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'

export interface ImportMatchingPageProps {
  displayName: string
  total: number
  matched: number
  failed?: boolean
  error?: string
  progressHref: string
  reviewHref: string
}

export function ImportMatchingPage(handle: Handle<ImportMatchingPageProps>) {
  return () => {
    const { displayName, total, matched, failed, error, progressHref, reviewHref } = handle.props
    const percent = total === 0 ? 0 : Math.min(100, Math.round((matched / total) * 100))

    return (
      <Document title="Matching your import | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          {failed ? (
            <>
              <h1>That import stopped</h1>
              <p mix={css({ color: '#b91c1c' })}>{error ?? 'Something went wrong while matching.'}</p>
              <p mix={css({ color: '#555' })}>
                Nothing was written to your log — upload the file again to start over.
              </p>
            </>
          ) : (
            <>
              <h1>Matching your films</h1>
              <p mix={css({ color: '#555' })}>Looking each row up in the catalog.</p>

              {/* Server-rendered at the count the page was requested with, so
                  this says something true before any script runs. */}
              <div
                mix={css({
                  height: '14px',
                  border: '1px solid #cfc5b6',
                  borderRadius: '999px',
                  background: '#f3ece2',
                  overflow: 'hidden',
                })}
              >
                <div
                  id="import-progress-bar"
                  mix={css({ height: '100%', background: '#cfe3d0', borderRight: '1px solid #9dbfa1' })}
                  style={`width: ${percent}%`}
                />
              </div>
              <p id="import-progress-label" mix={css({ fontSize: '13px', color: '#888', margin: '8px 0 18px' })}>
                {matched} of {total} rows
              </p>

              <div
                mix={css({
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '14px',
                  color: '#555',
                })}
              >
                You can close this page. Matching finishes in the background, and the results wait for
                you under Profile → Imports until you review them.
              </div>

              <ImportProgress
                progressHref={progressHref}
                reviewHref={reviewHref}
                barId="import-progress-bar"
                labelId="import-progress-label"
              />
            </>
          )}
        </main>
      </Document>
    )
  }
}
