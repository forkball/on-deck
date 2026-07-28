import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LetterboxdImportResult } from '../../data/letterboxdImport.ts'
import { routes } from '../../routes.ts'
import { LetterboxdImportForm } from '../../assets/letterboxd-import-form.tsx'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface LetterboxdImportPageProps {
  displayName: string
  error?: string
  result?: LetterboxdImportResult
}

export function LetterboxdImportPage(handle: Handle<LetterboxdImportPageProps>) {
  return () => {
    const { displayName, error, result } = handle.props

    return (
      <Document title="Import from Letterboxd | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Letterboxd</h1>

          {result ? (
            <>
              <p mix={css({ color: '#15803d' })}>
                Imported {result.imported} of {result.totalRows} rated movies.
              </p>
              {result.notFound.length > 0 && (
                <section mix={css({ marginTop: '24px' })}>
                  <h2>Couldn't match {result.notFound.length}</h2>
                  <p mix={css({ fontSize: '13px', color: '#888' })}>
                    No confident TMDB match for these — probably an obscure title, a typo, or a
                    release TMDB doesn't have under that name.
                  </p>
                  <ul mix={css({ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' })}>
                    {result.notFound.map(({ title, year }) => (
                      <li key={`${title}-${year}`} mix={css({ fontSize: '14px' })}>
                        {title}
                        {year ? ` (${year})` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p mix={css({ marginTop: '24px' })}>
                <a href={routes.profile.index.href()}>View your profile →</a>
              </p>
            </>
          ) : (
            <>
              <p mix={css({ color: '#555' })}>
                Upload the .zip Letterboxd emails you when you request your data (Settings → Data →
                Export). We only read <code>ratings.csv</code> from it — everything else in the
                export (diary, reviews, watchlist, lists, comments) is ignored. Each rated movie is
                matched against TMDB by title and year and logged as watched with your original
                rating and date.
              </p>
              {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
              <LetterboxdImportForm uploadHref={routes.letterboxd.upload.href()} />
            </>
          )}
        </main>
      </Document>
    )
  }
}
