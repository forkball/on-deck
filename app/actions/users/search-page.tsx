import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PROFILE_HREF_PLACEHOLDER, UserSearchForm } from '../../browser/user-search-form.tsx'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface UserSearchPageProps {
  query: string
  results: User[]
  followingByUserId: Map<number, boolean>
  displayName: string
}

export function UserSearchPage(handle: Handle<UserSearchPageProps>) {
  return () => {
    const { query, results, followingByUserId, displayName } = handle.props
    const returnTo = query
      ? `${routes.users.search.href()}?q=${encodeURIComponent(query)}`
      : routes.users.search.href()

    return (
      <Document title="Find people | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Find people</h1>
          <UserSearchForm
            query={query}
            searchHref={routes.users.search.href()}
            suggestHref={routes.users.suggest.href()}
            profileHrefTemplate={routes.users.show.href({ userId: PROFILE_HREF_PLACEHOLDER })}
          />

          {query && results.length === 0 && <p>No one found for "{query}".</p>}

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
            {results.map((user) => {
              const following = followingByUserId.get(user.id) ?? false
              // Public profiles are viewable by anyone; private ones still
              // need a follow — see canViewProfile.
              const canView = !user.is_private || following
              return (
                <li
                  key={user.id}
                  mix={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '12px 16px',
                  })}
                >
                  <div mix={css({ minWidth: 0, overflowWrap: 'break-word' })}>
                    {canView ? (
                      <a href={routes.users.show.href({ userId: String(user.id) })}>
                        <strong>{displayLabel(user)}</strong>
                      </a>
                    ) : (
                      <strong>{displayLabel(user)}</strong>
                    )}
                  </div>

                  <form
                    method="post"
                    mix={css({ flexShrink: 0 })}
                    action={
                      following
                        ? routes.users.unfollow.href({ userId: String(user.id) })
                        : routes.users.follow.href({ userId: String(user.id) })
                    }
                  >
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button type="submit">{following ? 'Unfollow' : 'Follow'}</button>
                  </form>
                </li>
              )
            })}
          </ul>
        </main>
      </Document>
    )
  }
}
