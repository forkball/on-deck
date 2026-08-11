import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../components/document.tsx'
import { Nav } from '../components/nav.tsx'

export interface FollowListPageProps {
  title: string
  heading: string
  users: User[]
  // The viewer's own follow-state for each listed user — gates whether their
  // name links to a profile (you can only view profiles of people you
  // follow, see requireFollowedUser) and drives the Follow/Unfollow button.
  followingByUserId: Map<number, boolean>
  // The viewer, so their own row can be marked and left without a Follow
  // button. They legitimately appear in these lists — you are one of the
  // people who follows the person whose followers you're reading.
  viewerId: number
  emptyMessage: string
  returnTo: string
  displayName: string
}

// Shared by /profile/following, /profile/followers, /users/:id/following,
// and /users/:id/followers — same row shape as the "Find people" search
// results, just sourced from a follow list instead of a name search.
export function FollowListPage(handle: Handle<FollowListPageProps>) {
  return () => {
    const { title, heading, users, followingByUserId, viewerId, emptyMessage, returnTo, displayName } =
      handle.props

    return (
      <Document title={`${title} | On Deck`}>
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{heading}</h1>

          {users.length === 0 ? (
            <p>{emptyMessage}</p>
          ) : (
            <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' })}>
              {users.map((user) => {
                const following = followingByUserId.get(user.id) ?? false
                const isViewer = user.id === viewerId
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
                    {following ? (
                      <a href={routes.users.show.href({ userId: String(user.id) })}>
                        <strong>{displayLabel(user)}</strong>
                      </a>
                    ) : (
                      <strong>{displayLabel(user)}</strong>
                    )}

                    {isViewer ? (
                      <span mix={css({ fontSize: '13px', color: '#555' })}>You</span>
                    ) : (
                      <form
                        method="post"
                        action={
                          following
                            ? routes.users.unfollow.href({ userId: String(user.id) })
                            : routes.users.follow.href({ userId: String(user.id) })
                        }
                      >
                        <input type="hidden" name="return_to" value={returnTo} />
                        <button type="submit">{following ? 'Unfollow' : 'Follow'}</button>
                      </form>
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
