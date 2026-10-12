import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { User } from '../../data/schema.ts'
import { Page } from '../components/page.tsx'
import { UserCard } from '../components/user-card.tsx'

export interface FollowListPageProps {
  title: string
  heading: string
  users: User[]
  // The viewer's own follow-state for each listed user — gates whether a
  // private profile's name links anywhere (see canViewProfile; public
  // profiles link regardless) and drives the Follow/Unfollow button.
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
// and /users/:id/followers — same row shape as the "Search people"
// results (UserCard), just sourced from a follow list instead of a name search.
export function FollowListPage(handle: Handle<FollowListPageProps>) {
  return () => {
    const { title, heading, users, followingByUserId, viewerId, emptyMessage, returnTo, displayName } =
      handle.props

    return (
      <Page title={title} heading={heading} displayName={displayName}>
        {users.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : (
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
            {users.map((user) => {
              const following = followingByUserId.get(user.id) ?? false
              const isViewer = user.id === viewerId
              return (
                <UserCard
                  key={user.id}
                  user={user}
                  following={following}
                  canView={!user.is_private || following || isViewer}
                  isViewer={isViewer}
                  returnTo={returnTo}
                />
              )
            })}
          </ul>
        )}
      </Page>
    )
  }
}
