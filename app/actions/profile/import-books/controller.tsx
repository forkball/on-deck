import { createController } from 'remix/router'

import { parseGoodreadsLibrary } from '../../../data/imports/goodreads.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { createFileImportActions } from '../fileImportActions.tsx'
import { GoodreadsImportPage } from './page.tsx'

// The upload flow itself is createFileImportActions — see import-movies for the
// other one. Only the parser, the page and the wording are per source.
export default createController(routes.profile.importBooks, {
  middleware: [requireAuth<User>()],
  actions: createFileImportActions({
    mediaType: 'book',
    source: 'goodreads',
    page: GoodreadsImportPage,
    fieldName: 'library',
    // A plain .csv, so text is enough.
    parse: async (file) => ({ rows: parseGoodreadsLibrary(await file.text()) }),
    missingFileError: 'Choose your goodreads_library_export.csv file first.',
    emptyError: 'That file has no books on a shelf we recognise.',
  }),
})
