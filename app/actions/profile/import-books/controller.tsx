import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { activeBatch, createBatch } from '../../../data/imports/batches.ts'
import { parseGoodreadsLibrary } from '../../../data/imports/goodreads.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { GoodreadsImportPage } from './page.tsx'

// Mirrors profile/import-movies (Letterboxd) — see that controller; the only
// differences are which parser runs and which page renders.
export default createController(routes.profile.importBooks, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)

      const pending = await activeBatch(context.get(Database), auth.identity.id, 'book')

      return context.render(
        <GoodreadsImportPage
          displayName={displayLabel(auth.identity)}
          pendingHref={pending ? routes.profile.imports.show.href({ batchId: pending.id }) : undefined}
        />,
      )
    },

    async upload(context) {
      const auth = context.get(Auth)

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

      try {
        const rows = parseGoodreadsLibrary(await file.text())

        if (rows.length === 0) {
          return context.render(
            <GoodreadsImportPage
              error="That file has no books on a shelf we recognise."
              displayName={displayLabel(auth.identity)}
            />,
            { status: 400 },
          )
        }

        const batchId = await createBatch(db, auth.identity.id, 'book', 'goodreads', rows)
        return redirect(routes.profile.imports.show.href({ batchId }), 303)
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
