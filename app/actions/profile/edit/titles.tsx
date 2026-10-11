import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PART_NAMES, type TitleProgress } from '../../../data/profileTitles/catalog.ts'
import { routes } from '../../../routes.ts'
import { CreditGroups } from '../../../ui/components/credit-tiles.tsx'
import { Link } from '../../../ui/shared/form-controls.tsx'

export interface TitlesProps {
  progress: TitleProgress[]
  unlocked: ReadonlySet<string>
  // The keys worn now, either of which may be unset.
  adjective: string | null
  noun: string | null
  // Where a pick comes back to: this tab.
  returnTo: string
  // Admins get a link to how the credits are spread across everyone.
  isAdmin: boolean
}

// The settings pane for titles: every credit there is, with your progress on
// each. Tapping one opens it, and an earned one is worn from there — see
// WearForm. Always has something to pick, since everyone holds the starter
// credits.
export function Titles(handle: Handle<TitlesProps>) {
  return () => {
    const { progress, unlocked, adjective, noun, returnTo, isAdmin } = handle.props

    return (
      <section>
        <h2 mix={css({ marginTop: 0 })}>Your title</h2>

        <p mix={css({ margin: '0 0 8px', color: 'var(--soft)' })}>
          Your title is a {PART_NAMES.adjective.one.toLowerCase()} and a {PART_NAMES.noun.one.toLowerCase()}{' '}
          you've earned. Tap any credit to see what earns it, and wear an earned one from there.
        </p>

        <CreditGroups
          credits={progress.map(({ title, current }) => ({
            title,
            earned: unlocked.has(title.key),
            current,
          }))}
          picking={{ adjective, noun, returnTo }}
        />
        {isAdmin && (
          <p mix={css({ marginTop: '24px', fontSize: '13px' })}>
            <Link href={routes.admin.credits.href()}>How many members hold each credit (admin) →</Link>
          </p>
        )}
      </section>
    )
  }
}
