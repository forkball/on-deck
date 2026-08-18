import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { activeBatch, createBatch } from '../../../data/imports/batches.ts'
import { parseLetterboxdRatings } from '../../../data/imports/letterboxd.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { LetterboxdImportPage } from './page.tsx'

export default createController(routes.profile.importMovies, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      // An import someone is midway through outranks the upload form: starting
      // a second one would orphan the review they haven't finished.
      const pending = await activeBatch(context.get(Database), auth.identity.id, 'movie')

      return context.render(
        <LetterboxdImportPage
          displayName={displayLabel(auth.identity)}
          pendingHref={pending ? routes.profile.imports.show.href({ batchId: pending.id }) : undefined}
        />,
      )
    },

    async upload(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)
      const file = formData.get('ratings')

      if (!(file instanceof File) || file.size === 0) {
        return context.render(
          <LetterboxdImportPage
            error="Choose your ratings.csv file first."
            displayName={displayLabel(auth.identity)}
          />,
          { status: 400 },
        )
      }

      const db = context.get(Database)

      try {
        const rows = parseLetterboxdRatings(await file.text())

        if (rows.length === 0) {
          return context.render(
            <LetterboxdImportPage
              error="That file has no rated films in it."
              displayName={displayLabel(auth.identity)}
            />,
            { status: 400 },
          )
        }

        // The request ends here: matching a few hundred rows is tens of seconds
        // of catalog lookups, which a worker does while this redirect lands.
        const batchId = await createBatch(db, auth.identity.id, 'movie', 'letterboxd', rows)
        return redirect(routes.profile.imports.show.href({ batchId }), 303)
      } catch (error) {
        return context.render(
          <LetterboxdImportPage
            error={error instanceof Error ? error.message : 'Something went wrong reading that file.'}
            displayName={displayLabel(auth.identity)}
          />,
          { status: 400 },
        )
      }
    },
  },
})
