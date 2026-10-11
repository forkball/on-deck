import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { composeTitle, type TitleProgress } from '../../../data/profileTitles/catalog.ts'
import { routes } from '../../../routes.ts'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, Select } from '../../../ui/shared/form-controls.tsx'

export interface TitlesProps {
  progress: TitleProgress[]
  unlocked: ReadonlySet<string>
  // The keys worn now, either of which may be unset.
  adjective: string | null
  noun: string | null
}

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '10px',
})

const itemStyle = css({
  border: '1px solid var(--rule)',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
})

const lockedStyle = css({ opacity: 0.6, borderStyle: 'dashed' })

const earnedStyle = css({ borderLeft: '4px solid var(--accent)', background: 'var(--paper-tint)' })

const metaStyle = css({ fontSize: '12px', color: 'var(--muted)' })

// One kind of word, every one there is, so the ones not yet earned say what
// earning them takes. Showing those words before they're earned is deliberate —
// "Spooky" is a better reason to watch ten horror films than a padlock is.
function WordList(
  handle: Handle<{ heading: string; progress: TitleProgress[]; unlocked: ReadonlySet<string> }>,
) {
  return () => {
    const { heading, progress, unlocked } = handle.props
    const earnedCount = progress.filter((entry) => unlocked.has(entry.title.key)).length

    return (
      <>
        <h2>
          {heading} — earned {earnedCount} of {progress.length}
        </h2>
        <ul mix={listStyle}>
          {progress.map(({ title, current }) => {
            const isEarned = unlocked.has(title.key)
            return (
              <li key={title.key} mix={[itemStyle, isEarned ? earnedStyle : lockedStyle]}>
                <strong>{title.word}</strong>
                <span mix={css({ fontSize: '14px' })}>{title.requirement}</span>
                <span mix={metaStyle}>
                  {isEarned ? 'Earned' : `${Math.min(current, title.goal)} / ${title.goal}`}
                </span>
              </li>
            )
          })}
        </ul>
      </>
    )
  }
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

// The settings pane for titles: the two pickers, then every word there is. Each
// achievement earns one word; adjectives go first and nouns second.
export function Titles(handle: Handle<TitlesProps>) {
  return () => {
    const { progress, unlocked, adjective, noun } = handle.props
    const adjectives = progress.filter((entry) => entry.title.part === 'adjective')
    const nouns = progress.filter((entry) => entry.title.part === 'noun')
    const earnedAdjectives = adjectives.filter((entry) => unlocked.has(entry.title.key))
    const earnedNouns = nouns.filter((entry) => unlocked.has(entry.title.key))
    const current = composeTitle(adjective, noun)

    return (
      <section>
        <h2 mix={css({ marginTop: 0 })}>Your title</h2>
        <p mix={css({ margin: '0 0 16px', color: 'var(--soft)' })}>
          {current ? (
            <>
              You're wearing <strong>{current}</strong>. It shows under your name on your profile.
            </>
          ) : earnedAdjectives.length + earnedNouns.length > 0 ? (
            'Pick a first and a second word from the ones you have earned.'
          ) : (
            'Every achievement earns a word for your title. Log something to earn your first.'
          )}
        </p>

        {earnedAdjectives.length + earnedNouns.length > 0 && (
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
            <WordPicker label="First word" name="adjective" earned={earnedAdjectives} selected={adjective} />
            <WordPicker label="Second word" name="noun" earned={earnedNouns} selected={noun} />
            <div>
              <Button type="submit" variant="primary">
                Wear this title
              </Button>
            </div>
          </form>
        )}

        <WordList heading="First words" progress={adjectives} unlocked={unlocked} />
        <WordList heading="Second words" progress={nouns} unlocked={unlocked} />
      </section>
    )
  }
}
