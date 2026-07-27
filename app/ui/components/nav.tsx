import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../routes.ts'

export function Nav(handle: Handle<{ authed: boolean; displayName?: string }>) {
  return () => {
    const { authed, displayName } = handle.props

    return (
      <nav
        mix={css({
          display: 'flex',
          gap: '20px',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #ccc',
          fontSize: '14px',
        })}
      >
        <a href={routes.home.href()} mix={css({ fontWeight: 700, textDecoration: 'none' })}>
          On Deck
        </a>
        {authed ? (
          <>
            <a href={routes.movies.search.href()}>Search Movies</a>
            <a href={routes.recommendations.index.href()}>Recommendations</a>
            <a href={routes.users.search.href()}>Find People</a>
            <a
              href={routes.profile.index.href()}
              mix={css({ marginLeft: 'auto' })}
            >
              {displayName || 'My Profile'}
            </a>
            <form method="post" action={routes.auth.logout.href()}>
              <button type="submit">Log out</button>
            </form>
          </>
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
