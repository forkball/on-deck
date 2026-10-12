import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { NotificationSummary } from '../../data/notifications.ts'
import { PART_NAMES, titleByKey } from '../../data/profileTitles/catalog.ts'
import { routes } from '../../routes.ts'
import { ExpandableText } from '../../ui/components/expandable-text.tsx'
import { Page } from '../../ui/components/page.tsx'
import { Link } from '../../ui/shared/form-controls.tsx'

export interface NotificationsPageProps {
  notifications: NotificationSummary[]
  displayName: string
}

function earnedTitles(notification: NotificationSummary) {
  return notification.unlockedTitles.flatMap((key) => {
    const title = titleByKey(key)
    return title ? [title] : []
  })
}

// The credits a notification announces. One is named in the line itself;
// several are only counted there, and listed underneath by genre and role —
// a first visit can unlock a whole log's worth at once, and seventy-odd names
// in a link make the page a wall of underline.
function unlockedLine(notification: NotificationSummary) {
  const titles = earnedTitles(notification)
  const [only] = titles
  if (titles.length === 1 && only) {
    return (
      <>
        You earned a new {PART_NAMES[only.part].one.toLowerCase()}: <strong>{only.word}</strong>
      </>
    )
  }
  return <>You earned {titles.length} new credits</>
}

// Plain text, one line per part, so ExpandableText can clamp it.
function unlockedList(notification: NotificationSummary): string | null {
  const titles = earnedTitles(notification)
  if (titles.length < 2) return null
  return (['adjective', 'noun'] as const)
    .flatMap((part) => {
      const words = titles.filter((title) => title.part === part).map((title) => title.word)
      return words.length > 0 ? [`${PART_NAMES[part].many}: ${words.join(', ')}`] : []
    })
    .join('\n')
}

function describe(notification: NotificationSummary) {
  if (notification.type === 'title') return unlockedLine(notification)
  return (
    <>
      <strong>{notification.actorLabel}</strong>{' '}
      {notification.type === 'follow' ? 'started following you' : 'ran recommendations you can view'}
    </>
  )
}

export function NotificationsPage(handle: Handle<NotificationsPageProps>) {
  return () => {
    const { notifications, displayName } = handle.props

    return (
      <Page heading="Notifications" displayName={displayName}>
        {notifications.length === 0 ? (
          <p>
            Nothing yet — you'll hear about it here when you earn a new credit, when someone follows you, or
            when someone you follow (and who follows you back) runs a group recommendation with you in it.
          </p>
        ) : (
          <ul
            mix={css({
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            })}
          >
            {notifications.map((notification) => {
              const date = new Date(notification.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
              const list = notification.type === 'title' ? unlockedList(notification) : null

              return (
                <li
                  key={notification.id}
                  mix={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    // Top, not centre: the badge belongs by the headline when a
                    // credit list opens out underneath it.
                    alignItems: 'flex-start',
                    gap: '12px',
                    border: '1px solid var(--rule)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    backgroundColor: notification.read ? 'transparent' : 'rgba(21, 128, 61, 0.06)',
                  })}
                >
                  {/*
                      `rmx-document` is load-bearing: the `read` route only ever
                      redirects (to the follower's profile or the run), it never
                      renders a notifications-shaped page itself. Without this,
                      the framework does a client-side frame reload and has
                      nothing matching to patch the redirected page into, so the
                      tap appears to do nothing and the list is left stale.
                    */}
                  <div mix={css({ minWidth: 0 })}>
                    <Link
                      href={routes.notifications.read.href({ notificationId: String(notification.id) })}
                      rmx-document=""
                    >
                      {describe(notification)} — {date}
                    </Link>
                    {/* Outside the link, so "Read more" opens the list rather
                        than following it. */}
                    {list && (
                      <div mix={css({ marginTop: '6px', fontSize: '14px', color: 'var(--soft)' })}>
                        <ExpandableText
                          text={list}
                          id={`notification-${notification.id}-credits`}
                          maxLines={3}
                        />
                      </div>
                    )}
                  </div>
                  {!notification.read && (
                    <span
                      mix={css({
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--success)',
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
      </Page>
    )
  }
}
