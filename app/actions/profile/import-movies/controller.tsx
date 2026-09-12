import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { parseLetterboxdUpload } from '../../../data/imports/letterboxd.ts'
import { letterboxdSyncAvailableTo } from '../../../data/imports/letterboxdFeed.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { createFileImportActions } from '../file-import-actions.tsx'
import { LetterboxdImportPage, type LetterboxdConnection } from './page.tsx'

// The upload flow itself is createFileImportActions — see import-books for the
// other one. Only the parser, the page and the wording are per source.
//
// This page carries a second, unrelated flow as well: the RSS feed connection,
// which keeps the log current after the one-time upload. The two belong
// together because they are the same question ("get my Letterboxd into On
// Deck") answered at two timescales — the export backfills history the ~50-item
// feed can't reach, the feed keeps up with it afterwards.
export default createController(routes.profile.importMovies, {
  middleware: [requireAuth<User>()],
  actions: createFileImportActions<{ connection: LetterboxdConnection | null }>({
    mediaType: 'movie',
    source: 'letterboxd',
    page: LetterboxdImportPage,
    fieldName: 'ratings',
    // A .zip with the ratings and reviews as separate files inside, so this one
    // needs the bytes. It also answers reviewsOnly, which is what puts the
    // `partial=reviews` marker on the redirect.
    parse: async (file) => parseLetterboxdUpload(new Uint8Array(await file.arrayBuffer())),
    missingFileError: 'Choose your Letterboxd export .zip first.',
    emptyError: 'That export has no rated or reviewed films in it.',
    // The connect form redirects back here with its outcome, since it has no
    // page of its own to report on. Null for anyone the feed is gated from,
    // which takes the whole section off the page and leaves the upload flow
    // reading as it did before.
    extraProps: (context) => {
      const { identity } = context.get(Auth)

      return {
        connection: letterboxdSyncAvailableTo(identity)
          ? {
              username: identity.letterboxd_username ?? null,
              justConnected: context.url.searchParams.get('letterboxdConnected') === '1',
              error: context.url.searchParams.get('letterboxdError') ?? undefined,
            }
          : null,
      }
    },
  }),
})
