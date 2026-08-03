import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { importLetterboxdRatings } from '../../../data/imports/letterboxd.ts'
import type { User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { LetterboxdImportPage } from './page.tsx'

export default createController(routes.profile.importMovies, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      return context.render(<LetterboxdImportPage displayName={displayLabel(auth.identity)} />)
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
      const csvText = await file.text()

      try {
        const result = await importLetterboxdRatings(db, auth.identity.id, csvText)
        return context.render(
          <LetterboxdImportPage result={result} displayName={displayLabel(auth.identity)} />,
        )
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
