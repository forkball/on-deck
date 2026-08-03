import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { GoodreadsImportResult } from '../../../data/imports/goodreads.ts'
import { routes } from '../../../routes.ts'
import { LetterboxdImportForm } from '../../../assets/letterboxd-import-form.tsx'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'

export interface GoodreadsImportPageProps {
  displayName: string
  error?: string
  result?: GoodreadsImportResult
}

export function GoodreadsImportPage(handle: Handle<GoodreadsImportPageProps>) {
  return () => {
    const { displayName, error, result } = handle.props

    return (
      <Document title="Import from Goodreads | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Goodreads</h1>

          {result ? (
            <>
              <p mix={css({ color: '#15803d' })}>
                Imported {result.imported} of {result.totalRows} books — your read, currently-reading,
                and want-to-read shelves all carried over.
              </p>
              {result.matchedByTitle > 0 && (
                <p mix={css({ fontSize: '13px', color: '#888' })}>
                  {result.matchedByIsbn} matched exactly by ISBN; {result.matchedByTitle} had no ISBN in
                  the export and were matched on title and author, so those are worth a glance.
                </p>
              )}
              {result.notFound.length > 0 && (
                <section mix={css({ marginTop: '24px' })}>
                  <h2>Couldn't match {result.notFound.length}</h2>
                  <p mix={css({ fontSize: '13px', color: '#888' })}>
                    No confident Open Library match for these — usually a very obscure edition, or a
                    book catalogued there under a different title.
                  </p>
                  <ul
                    mix={css({
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    })}
                  >
                    {result.notFound.map(({ title, author }) => (
                      <li key={`${title}-${author}`} mix={css({ fontSize: '14px' })}>
                        {title}
                        {author ? ` — ${author}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              <p mix={css({ color: '#555' })}>
                Export your library from Goodreads (My Books → Import and export → Export Library) and
                upload the <code>goodreads_library_export.csv</code> it emails you.
              </p>
              <LetterboxdImportForm
                uploadHref={routes.profile.importBooks.upload.href()}
                fieldName="library"
                error={error}
              />
            </>
          )}
        </main>
      </Document>
    )
  }
}
