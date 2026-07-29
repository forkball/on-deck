import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { NotificationSummary } from '../../data/notifications.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface NotificationsPageProps {
  notifications: NotificationSummary[]
  displayName: string
}

export function NotificationsPage(handle: Handle<NotificationsPageProps>) {
  return () => {
    const { notifications, displayName } = handle.props

    return (
      <Document title="Notifications | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Notifications</h1>

          {notifications.length === 0 ? (
            <p>Nothing yet — you'll hear about it here when someone you follow (and who follows you back) runs a group recommendation with you in it.</p>
          ) : (
            <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' })}>
              {notifications.map((notification) => {
                const date = new Date(notification.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })

                return (
                  <li
                    key={notification.id}
                    mix={css({
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      backgroundColor: notification.read ? 'transparent' : 'rgba(21, 128, 61, 0.06)',
                    })}
                  >
                    <a href={routes.notifications.read.href({ notificationId: String(notification.id) })}>
                      <strong>{notification.actorLabel}</strong> ran recommendations you can view — {date}
                    </a>
                    {!notification.read && (
                      <span
                        mix={css({
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#15803d',
                          flex: '0 0 auto',
                        })}
                      >
                        NEW
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </main>
      </Document>
    )
  }
}
