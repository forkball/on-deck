import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Page } from '../components/page.tsx'
import { Button, Link } from '../shared/form-controls.tsx'

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
// and /users/:id/followers — same row shape as the "Find people" search
// results, just sourced from a follow list instead of a name search.
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
              gap: '12px',
            })}
          >
            {users.map((user) => {
              const following = followingByUserId.get(user.id) ?? false
              const isViewer = user.id === viewerId
              const canView = !user.is_private || following || isViewer
              return (
                <li
                  key={user.id}
                  mix={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    border: '1px solid var(--rule)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                  })}
                >
                  <div mix={css({ minWidth: 0, overflowWrap: 'break-word' })}>
                    {canView ? (
                      <Link href={routes.users.show.href({ userId: String(user.id) })} tapArea>
                        <strong>{displayLabel(user)}</strong>
                      </Link>
                    ) : (
                      <strong>{displayLabel(user)}</strong>
                    )}
                  </div>

                  {isViewer ? (
                    <span mix={css({ fontSize: '13px', color: 'var(--soft)', flexShrink: 0 })}>You</span>
                  ) : (
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
                      <Button type="submit">{following ? 'Unfollow' : 'Follow'}</Button>
                    </form>
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
