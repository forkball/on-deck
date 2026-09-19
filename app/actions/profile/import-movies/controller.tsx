import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { parseLetterboxdUpload } from '../../../data/imports/letterboxd.ts'
import { letterboxdSyncAvailableTo } from '../../../data/imports/letterboxdFeed.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { createFileImportActions } from '../file-import-actions.tsx'
import { LetterboxdImportPage } from './page.tsx'

// The upload flow itself is createFileImportActions — see import-books for the
// other one. Only the parser, the page and the wording are per source.
//
// The feed connection used to live on this page too, on the reasoning that the
// export and the feed answer one question at two timescales. They do, but a
// connection is account state that outlives any import, so it is managed in
// settings now; what stays here is the sentence explaining the division of
// labour, which only makes sense to someone the feed is available to.
export default createController(routes.profile.importMovies, {
  middleware: [requireAuth<User>()],
  actions: createFileImportActions<{ syncAvailable: boolean }>({
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
    // Gated off, the page reads exactly as it did before the feed existed:
    // an upload, and nothing about keeping up.
    extraProps: (context) => ({
      syncAvailable: letterboxdSyncAvailableTo(context.get(Auth).identity),
    }),
  }),
})
