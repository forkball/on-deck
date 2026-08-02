import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { countUnreadNotifications, listNotifications, markNotificationRead } from '../../data/notifications.ts'
import { notifications } from '../../data/schema.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { NotificationsPage } from './page.tsx'

export default createController(routes.notifications, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const notifications = await listNotifications(db, auth.identity.id)

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

    // Marking read happens as a side effect of opening the notification
    // (via this GET), not on viewing the list — otherwise every unread
    // notification would flip to read the moment you land on the page,
    // before you'd actually looked at any of them.
    async read(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const notificationId = Number(context.params.notificationId)
      const db = context.get(Database)
      const notification = await db.find(notifications, notificationId)
      if (!notification || notification.user_id !== auth.identity.id) {
        return new Response('Not Found', { status: 404 })
      }

      await markNotificationRead(db, notificationId, auth.identity.id)

      // Each kind opens the thing it's about: a run for recommendations, the
      // person's profile for a follow.
      if (notification.type === 'follow') {
        return redirect(routes.users.show.href({ userId: String(notification.actor_user_id) }), 303)
      }

      // A recommendation notification without a run predates nothing and
      // shouldn't exist, but a dangling redirect would 404 confusingly.
      if (notification.run_id == null) {
        return redirect(routes.notifications.index.href(), 303)
      }

      return redirect(routes.recommendations.show.href({ runId: String(notification.run_id) }), 303)
    },
  },
})
