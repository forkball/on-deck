import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { loadCreditTallies } from '../../data/profileTitles/unlocks.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { routes } from '../../routes.ts'
import { AdminCreditsPage } from './credits-page.tsx'

export default createController(routes.admin, {
  middleware: [requireAuth<User>()],
  actions: {
    async credits(context) {
      const auth = context.get(Auth)
      if (!auth.identity.is_admin) return new Response('Forbidden', { status: 403 })

      return context.render(
        <AdminCreditsPage
          tallies={await loadCreditTallies(context.get(Database))}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },
  },
})
