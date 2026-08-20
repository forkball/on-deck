import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { LetterboxdImportForm } from '../../../browser/letterboxd-import-form.tsx'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'

export interface GoodreadsImportPageProps {
  displayName: string
  error?: string
  pendingHref?: string
}

export function GoodreadsImportPage(handle: Handle<GoodreadsImportPageProps>) {
  return () => {
    const { displayName, error, pendingHref } = handle.props

    return (
      <Document title="Import from Goodreads | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Goodreads</h1>

          {pendingHref && (
            <div mix={css({ fontSize: '14px', marginBottom: '12px' })}>
              You have an import waiting. <a href={pendingHref}>Pick it back up</a> — uploading again
              starts over.
            </div>
          )}

          <p mix={css({ color: '#555' })}>
            Export your library from Goodreads (My Books → Import and export → Export Library) and
            upload the <code>goodreads_library_export.csv</code> it emails you. Your read,
            currently-reading and want-to-read shelves all come across, and so does anything you
            wrote in a review.
          </p>

          <LetterboxdImportForm
            uploadHref={routes.profile.importBooks.upload.href()}
            fieldName="library"
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
