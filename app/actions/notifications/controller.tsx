import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { countUnreadNotifications, listNotifications, markAllNotificationsRead } from '../../data/notifications.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { NotificationsPage } from './page.tsx'

export default createController(routes.notifications, {
  middleware: [requireAuth<User>()],
  actions: {
    // Viewing the list marks everything read — no per-row "mark read" UI.
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const notifications = await listNotifications(db, auth.identity.id)
      await markAllNotificationsRead(db, auth.identity.id)

      return context.render(
        <NotificationsPage notifications={notifications} displayName={displayLabel(auth.identity)} />,
      )
    },

    async unreadCount(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const count = await countUnreadNotifications(db, auth.identity.id)

      return Response.json({ count })
    },
  },
})
