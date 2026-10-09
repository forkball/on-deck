import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { NotificationBell } from '../../browser/notification-bell.tsx'
import { ProfileMenu } from '../../browser/profile-menu.tsx'
import { routes } from '../../routes.ts'
import { Link } from '../shared/form-controls.tsx'

// The widest a page gets: Page's `wide` column matches it, so wide content
// lines up with the nav above it.
export const NAV_WIDTH = '720px'

export function Nav(handle: Handle<{ authed: boolean; displayName?: string }>) {
  return () => {
    const { authed, displayName } = handle.props

    return (
      <nav
        mix={css({
          borderTop: '4px solid var(--accent)',
          borderBottom: '1px solid var(--rule)',
          fontSize: '14px',
        })}
      >
        <div
          mix={css({
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            maxWidth: NAV_WIDTH,
            margin: '0 auto',
            padding: '16px 24px',
          })}
        >
          <Link href={routes.home.href()} variant="brand" tapArea>
            On Deck
          </Link>
          {authed ? (
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' })}>
              <NotificationBell
                href={routes.notifications.index.href()}
                countHref={routes.notifications.unreadCount.href()}
              />
              <ProfileMenu
                displayName={displayName || 'My Profile'}
                links={[
                  { href: routes.media.href(), label: 'Search' },
                  { href: routes.users.search.href(), label: 'People' },
                  { href: routes.recommendations.index.href(), label: 'Recommendations' },
                  { href: routes.profile.index.href(), label: 'Profile' },
                  // Its own entry rather than something to find behind the
                  // profile: it holds the connected accounts, and this is the
                  // only link to it.
                  { href: routes.profile.edit.index.href(), label: 'Settings' },
                ]}
                logoutHref={routes.auth.logout.href()}
              />
            </div>
          ) : (
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' })}>
              <Link href={routes.auth.login.index.href()} tapArea>
                Log in
              </Link>
              <Link href={routes.auth.signup.index.href()} tapArea>
                Sign up
              </Link>
            </div>
          )}
        </div>
      </nav>
    )
  }
}
