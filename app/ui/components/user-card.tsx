import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { composeTitle } from '../../data/profileTitles/catalog.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Button, Link } from '../shared/form-controls.tsx'
import { UserTitle } from './user-title.tsx'

// Framed like a media search result (media-item-card.tsx) — the same padding,
// the coloured left edge and the action pinned to the top — so People reads as
// one more tab of the same search.
const cardStyle = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  border: '1px solid var(--rule)',
  borderLeft: '4px solid var(--accent)',
  borderRadius: '8px',
  padding: '16px',
})

// One person in a list of people: People search and the four follow lists.
export function UserCard(
  handle: Handle<{
    user: User
    // The viewer's follow state, which drives the button.
    following: boolean
    // False for a private profile the viewer doesn't follow: the name is shown
    // but leads nowhere — see canViewProfile.
    canView: boolean
    // The viewer's own row, which says "You" rather than offering a follow.
    isViewer?: boolean
    returnTo: string
  }>,
) {
  return () => {
    const { user, following, canView, isViewer, returnTo } = handle.props
    const label = displayLabel(user)

    return (
      <li mix={cardStyle}>
        <div mix={css({ minWidth: 0, overflowWrap: 'break-word' })}>
          {canView ? (
            <Link href={routes.users.show.href({ userId: String(user.id) })}>{label}</Link>
          ) : (
            <strong>{label}</strong>
          )}
          <UserTitle title={composeTitle(user.title_adjective, user.title_noun)} card />
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
  }
}
