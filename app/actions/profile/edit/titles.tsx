import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PART_NAMES, type TitleProgress } from '../../../data/profileTitles/catalog.ts'
import { routes } from '../../../routes.ts'
import { Field } from '../../../ui/shared/field.tsx'
import { CreditTiles } from '../../../ui/components/credit-tiles.tsx'
import { Button, Link, Select } from '../../../ui/shared/form-controls.tsx'

export interface TitlesProps {
  progress: TitleProgress[]
  unlocked: ReadonlySet<string>
  // The keys worn now, either of which may be unset.
  adjective: string | null
  noun: string | null
  // Admins get a link to how the credits are spread across everyone.
  isAdmin: boolean
}

function WordPicker(
  handle: Handle<{ label: string; name: string; earned: TitleProgress[]; selected: string | null }>,
) {
  return () => {
    const { label, name, earned, selected } = handle.props

    return (
      <Field label={label}>
        <Select name={name}>
          <option value="" selected={selected == null}>
            (none)
          </option>
          {earned.map(({ title }) => (
            <option key={title.key} value={title.key} selected={title.key === selected}>
              {title.word}
            </option>
          ))}
        </Select>
      </Field>
    )
  }
}

// The settings pane for titles: a genre picker and a role picker over the
// credits you've earned, then every credit there is with your progress on each.
// Always has something to pick from, since everyone holds the starter credits.
export function Titles(handle: Handle<TitlesProps>) {
  return () => {
    const { progress, unlocked, adjective, noun, isAdmin } = handle.props
    const adjectives = progress.filter((entry) => entry.title.part === 'adjective')
    const nouns = progress.filter((entry) => entry.title.part === 'noun')
    const earnedAdjectives = adjectives.filter((entry) => unlocked.has(entry.title.key))
    const earnedNouns = nouns.filter((entry) => unlocked.has(entry.title.key))

    return (
      <section>
        <h2 mix={css({ marginTop: 0 })}>Your title</h2>

        <form
          method="post"
          action={routes.profile.title.href()}
          mix={css({
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '12px',
            marginBottom: '32px',
          })}
        >
          <WordPicker
            label={PART_NAMES.adjective.one}
            name="adjective"
            earned={earnedAdjectives}
            selected={adjective}
          />
          <WordPicker label={PART_NAMES.noun.one} name="noun" earned={earnedNouns} selected={noun} />
          <div>
            <Button type="submit" variant="primary">
              Wear this title
            </Button>
          </div>
        </form>

        <CreditTiles
          heading={PART_NAMES.adjective.many}
          credits={adjectives.map(({ title, current }) => ({
            title,
            earned: unlocked.has(title.key),
            current,
          }))}
        />
        <CreditTiles
          heading={PART_NAMES.noun.many}
          credits={nouns.map(({ title, current }) => ({ title, earned: unlocked.has(title.key), current }))}
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
