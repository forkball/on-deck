import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ProfileMenu } from '../../assets/profile-menu.tsx'
import { routes } from '../../routes.ts'

export function Nav(handle: Handle<{ authed: boolean; displayName?: string }>) {
  return () => {
    const { authed, displayName } = handle.props

    return (
      <nav
        mix={css({
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          padding: '16px 24px',
          borderBottom: '1px solid #ccc',
          fontSize: '14px',
        })}
      >
        <a href={routes.home.href()} mix={css({ fontWeight: 700, textDecoration: 'none' })}>
          On Deck
        </a>
        {authed ? (
          <ProfileMenu
            displayName={displayName || 'My Profile'}
            links={[
              { href: routes.movies.search.href(), label: 'Search Movies' },
              { href: routes.recommendations.index.href(), label: 'Recommendations' },
              { href: routes.users.search.href(), label: 'Find People' },
              { href: routes.profile.index.href(), label: 'My Profile' },
            ]}
            logoutHref={routes.auth.logout.href()}
          />
        ) : (
          <>
            <a href={routes.auth.login.index.href()}>Log in</a>
            <a href={routes.auth.signup.index.href()}>Sign up</a>
          </>
        )}
      </nav>
    )
  }
}
