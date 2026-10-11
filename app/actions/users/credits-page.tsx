import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { composeTitle, PART_NAMES, titlesOfPart } from '../../data/profileTitles/catalog.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { CreditTiles } from '../../ui/components/credit-tiles.tsx'
import { Page } from '../../ui/components/page.tsx'

export interface UserCreditsPageProps {
  user: User
  earned: ReadonlySet<string>
  displayName: string
}

// Someone else's credits: every word there is, theirs marked. Their progress on
// the rest isn't shown — see Credit.current.
export function UserCreditsPage(handle: Handle<UserCreditsPageProps>) {
  return () => {
    const { user, earned, displayName } = handle.props
    const label = displayLabel(user)
    const title = composeTitle(user.title_adjective, user.title_noun)
    const creditsOf = (part: 'adjective' | 'noun') =>
      titlesOfPart(part).map((definition) => ({ title: definition, earned: earned.has(definition.key) }))

    return (
      <Page
        heading={`${label}'s credits`}
        back={{ href: routes.users.show.href({ userId: String(user.id) }), label: `← ${label}'s profile` }}
        displayName={displayName}
      >
        <p mix={css({ margin: '0 0 8px', color: 'var(--soft)' })}>
          {title ? (
            <>
              Wearing <strong>{title}</strong>, from {earned.size} credit{earned.size === 1 ? '' : 's'}{' '}
              earned.
            </>
          ) : earned.size > 0 ? (
            `${earned.size} credit${earned.size === 1 ? '' : 's'} earned, and no title worn yet.`
          ) : (
            'No credits earned yet.'
          )}
        </p>
        <CreditTiles heading={PART_NAMES.adjective.many} credits={creditsOf('adjective')} />
        <CreditTiles heading={PART_NAMES.noun.many} credits={creditsOf('noun')} />
      </Page>
    )
  }
}
