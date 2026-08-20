import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { LetterboxdImportForm } from '../../../browser/letterboxd-import-form.tsx'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'

export interface LetterboxdImportPageProps {
  displayName: string
  error?: string
  // Set when an earlier upload is still waiting to be matched or reviewed.
  pendingHref?: string
}

export function LetterboxdImportPage(handle: Handle<LetterboxdImportPageProps>) {
  return () => {
    const { displayName, error, pendingHref } = handle.props

    return (
      <Document title="Import from Letterboxd | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Letterboxd</h1>

          {pendingHref && (
            <div
              mix={css({
                border: '1px solid #d9cfbe',
                borderLeft: '4px solid #3E5C76',
                borderRadius: '8px',
                background: '#fbf4ea',
                padding: '12px 14px',
                marginBottom: '18px',
                fontSize: '14px',
              })}
            >
              You have an import waiting. <a href={pendingHref}>Pick it back up</a> — uploading again
              starts over.
            </div>
          )}

          <p mix={css({ color: '#555' })}>
            Export your data from Letterboxd (Settings → Data → Export) and upload the{' '}
            <code>.zip</code> it emails you, as it comes. Don't unzip it — your ratings and your
            reviews live in separate files inside, and both come across as one import.
          </p>

          <p mix={css({ color: '#555' })}>
            Exporting from Letterboxd's mobile app is unreliable — if the export doesn't come
            through, try it on{' '}
            <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noreferrer">
              desktop
            </a>{' '}
            or in a mobile browser instead.
          </p>

          <LetterboxdImportForm
            uploadHref={routes.profile.importMovies.upload.href()}
            accept=".zip"
            error={error}
          />

          <p mix={css({ fontSize: '13px', color: '#3E5C76' })}>
            Nothing is saved until you've seen what we matched.
          </p>
        </main>
      </Document>
    )
  }
}
