import { createController } from 'remix/router'

import { parseLetterboxdUpload } from '../../../data/imports/letterboxd.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { createFileImportActions } from '../fileImportActions.tsx'
import { LetterboxdImportPage } from './page.tsx'

// The upload flow itself is createFileImportActions — see import-books for the
// other one. Only the parser, the page and the wording are per source.
export default createController(routes.profile.importMovies, {
  middleware: [requireAuth<User>()],
  actions: createFileImportActions({
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
  }),
})
