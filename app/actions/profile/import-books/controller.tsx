import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { importGoodreadsLibrary } from '../../../data/goodreadsImport.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { GoodreadsImportPage } from './page.tsx'

// Mirrors profile/import-movies (Letterboxd) — see that controller; the only
// differences are which importer runs and which page renders.
export default createController(routes.profile.importBooks, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      return context.render(<GoodreadsImportPage displayName={displayLabel(auth.identity)} />)
    },

    async upload(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)
      const file = formData.get('library')

      if (!(file instanceof File) || file.size === 0) {
        return context.render(
          <GoodreadsImportPage
            error="Choose your goodreads_library_export.csv file first."
            displayName={displayLabel(auth.identity)}
          />,
          { status: 400 },
        )
      }

      const db = context.get(Database)
      const csvText = await file.text()

      try {
        const result = await importGoodreadsLibrary(db, auth.identity.id, csvText)
        return context.render(<GoodreadsImportPage result={result} displayName={displayLabel(auth.identity)} />)
      } catch (error) {
        return context.render(
          <GoodreadsImportPage
            error={error instanceof Error ? error.message : 'Something went wrong reading that file.'}
            displayName={displayLabel(auth.identity)}
          />,
          { status: 400 },
        )
      }
    },
  },
})
