import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PROFILE_HREF_PLACEHOLDER, UserSearchForm } from '../../browser/user-search-form.tsx'
import type { User } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { MediaTabLinks } from '../../ui/components/media-tab-links.tsx'
import { Page } from '../../ui/components/page.tsx'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { UserCard } from '../../ui/components/user-card.tsx'

export interface UserSearchPageProps {
  query: string
  // The viewer's order for the media-type tabs (parseMediaOrder).
  mediaOrder: ActiveMediaType[]
  results: User[]
  followingByUserId: Map<number, boolean>
  displayName: string
}

export function UserSearchPage(handle: Handle<UserSearchPageProps>) {
  return () => {
    const { query, mediaOrder, results, followingByUserId, displayName } = handle.props
    const returnTo = query
      ? `${routes.users.search.href()}?q=${encodeURIComponent(query)}`
      : routes.users.search.href()

    return (
      // Wide, like the media searches, so the shared tab bar sits the same.
      <Page heading="Search people" width="wide" displayName={displayName}>
        <MediaTabLinks
          current="people"
          order={mediaOrder}
          hrefFor={(type) => MEDIA_TYPE_UI[type].hrefs.search()}
          peopleHref={routes.users.search.href()}
        />
        <UserSearchForm
          query={query}
          searchHref={routes.users.search.href()}
          suggestHref={routes.users.suggest.href()}
          profileHrefTemplate={routes.users.show.href({ userId: PROFILE_HREF_PLACEHOLDER })}
        />

        {query && results.length === 0 && <p>No one found for "{query}".</p>}

        {/* Headed and spaced like the media searches' results. */}
        {results.length > 0 && (
          <section>
            <h2>
              Results{' '}
              <span mix={css({ fontSize: '14px', fontWeight: 400, color: 'var(--muted)' })}>
                ({results.length})
              </span>
            </h2>
            <ul
              mix={css({
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              })}
            >
              {results.map((user) => {
                const following = followingByUserId.get(user.id) ?? false
                return (
                  <UserCard
                    key={user.id}
                    user={user}
                    following={following}
                    // Public profiles are viewable by anyone; private ones
                    // still need a follow — see canViewProfile.
                    canView={!user.is_private || following}
                    returnTo={returnTo}
                  />
                )
              })}
            </ul>
          </section>
        )}
      </Page>
    )
  }
}
