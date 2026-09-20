import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { NotificationBell } from '../../browser/notification-bell.tsx'
import { ProfileMenu } from '../../browser/profile-menu.tsx'
import { routes } from '../../routes.ts'

export function Nav(handle: Handle<{ authed: boolean; displayName?: string }>) {
  return () => {
    const { authed, displayName } = handle.props

    return (
      <nav mix={css({ borderBottom: '1px solid #ccc', fontSize: '14px' })}>
        <div
          mix={css({
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            maxWidth: '720px',
            margin: '0 auto',
            padding: '16px 24px',
          })}
        >
          <a href={routes.home.href()} mix={css({ fontWeight: 700, textDecoration: 'none' })}>
            On Deck
          </a>
          {authed ? (
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' })}>
              <NotificationBell
                href={routes.notifications.index.href()}
                countHref={routes.notifications.unreadCount.href()}
              />
              <ProfileMenu
                displayName={displayName || 'My Profile'}
                links={[
                  { href: routes.media.href(), label: 'Media' },
                  { href: routes.users.search.href(), label: 'People' },
                  { href: routes.recommendations.index.href(), label: 'Recommendations' },
                  { href: routes.profile.index.href(), label: 'Profile' },
                  // Its own entry rather than something to find behind the
                  // profile: it holds the connected accounts now, and nobody
                  // hunting for those thinks to look under a pencil beside
                  // their own name.
                  { href: routes.profile.edit.index.href(), label: 'Settings' },
                ]}
                logoutHref={routes.auth.logout.href()}
              />
            </div>
          ) : (
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' })}>
              <a href={routes.auth.login.index.href()}>Log in</a>
              <a href={routes.auth.signup.index.href()}>Sign up</a>
            </div>
          )}
        </div>
      </nav>
    )
  }
}
