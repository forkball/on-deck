import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { composeTitle, type TitleProgress } from '../../../data/profileTitles/catalog.ts'
import { routes } from '../../../routes.ts'
import { Field } from '../../../ui/shared/field.tsx'
import { Modal } from '../../../ui/components/modal.tsx'
import { Button, Select, ToggleLabel } from '../../../ui/shared/form-controls.tsx'

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
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  alignItems: 'start',
  gap: '8px',
})

const tileStyle = css({
  border: '1px solid var(--rule)',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontWeight: 700,
  '&:hover': { borderColor: 'var(--accent)' },
})

const lockedStyle = css({ borderStyle: 'dashed', color: 'var(--muted)' })

const earnedStyle = css({ borderLeft: '4px solid var(--accent)', background: 'var(--paper-tint)' })

const barStyle = css({
  display: 'block',
  height: '4px',
  borderRadius: '2px',
  background: 'var(--rule)',
  overflow: 'hidden',
})

function ProgressBar(handle: Handle<{ current: number; goal: number }>) {
  return () => {
    const { current, goal } = handle.props
    return (
      <span mix={barStyle} aria-hidden="true">
        <span
          mix={css({
            display: 'block',
            height: '100%',
            width: `${Math.round((Math.min(current, goal) / goal) * 100)}%`,
            background: 'var(--accent)',
          })}
        />
      </span>
    )
  }
}

// One kind of word, every one there is, as tiles carrying just the word. A tap
// opens a small modal saying what earns it and how close you are — the list is
// for browsing the words, and thirty sentences at once buried them.
//
// Showing words before they're earned is deliberate: "Jump-Scared" is a better
// reason to watch ten horror films than a padlock is.
function WordList(
  handle: Handle<{ heading: string; progress: TitleProgress[]; unlocked: ReadonlySet<string> }>,
) {
  return () => {
    const { heading, progress, unlocked } = handle.props
    const earnedCount = progress.filter((entry) => unlocked.has(entry.title.key)).length

    return (
      <>
        <h2>
          {heading}{' '}
          <span mix={css({ fontSize: '14px', fontWeight: 400, color: 'var(--muted)' })}>
            {earnedCount} of {progress.length} earned
          </span>
        </h2>
        <ul mix={listStyle}>
          {progress.map(({ title, current }) => {
            const isEarned = unlocked.has(title.key)
            const modalId = `title-word-${title.key}`
            const shown = Math.min(current, title.goal)
            return (
              // Not a list-item: DoodleCSS gives every <li> a "* " marker,
              // unlayered, which beside a tile reads as a stray asterisk.
              <li key={title.key} mix={css({ display: 'block' })}>
                <ToggleLabel for={modalId} class="title-tile">
                  <span mix={[tileStyle, isEarned ? earnedStyle : lockedStyle]}>
                    <span>
                      {isEarned && <span aria-label="Earned">✓ </span>}
                      {title.word}
                    </span>
                    {!isEarned && <ProgressBar current={current} goal={title.goal} />}
                  </span>
                </ToggleLabel>
                <Modal id={modalId} title={title.word} small>
                  <p mix={css({ margin: '0 0 12px' })}>{title.requirement}.</p>
                  {isEarned ? (
                    <p mix={css({ margin: 0, color: 'var(--success)', fontWeight: 700 })}>✓ Earned</p>
                  ) : (
                    <>
                      <ProgressBar current={current} goal={title.goal} />
                      <p mix={css({ margin: '6px 0 0', fontSize: '13px', color: 'var(--muted)' })}>
                        {shown} of {title.goal} so far
                      </p>
                    </>
                  )}
                </Modal>
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
