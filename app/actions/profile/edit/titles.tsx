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

// The settings pane for titles: the two pickers, then every title there is, so
// the ones not yet earned say what earning them takes. Showing those words
// before they're earned is deliberate — "Gorehound" is a better reason to watch
// ten horror films than a padlock is.
export function Titles(handle: Handle<TitlesProps>) {
  return () => {
    const { progress, unlocked, adjective, noun } = handle.props
    const earned = progress.filter((entry) => unlocked.has(entry.title.key))
    const current = composeTitle(adjective, noun)

    return (
      <section>
        <h2 mix={css({ marginTop: 0 })}>Your title</h2>
        <p mix={css({ margin: '0 0 16px', color: 'var(--soft)' })}>
          {current ? (
            <>
              You're wearing <strong>{current}</strong>. It shows under your name on your profile.
            </>
          ) : earned.length > 0 ? (
            'Pick a first and a second word from the titles you have earned.'
          ) : (
            'Titles come from what you log and how you use On Deck. Log something to earn your first.'
          )}
        </p>

        {earned.length > 0 && (
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
            <Field label="First word">
              <Select name="adjective">
                <option value="" selected={adjective == null}>
                  (none)
                </option>
                {earned.map(({ title }) => (
                  <option key={title.key} value={title.key} selected={title.key === adjective}>
                    {title.adjective}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Second word">
              <Select name="noun">
                <option value="" selected={noun == null}>
                  (none)
                </option>
                {earned.map(({ title }) => (
                  <option key={title.key} value={title.key} selected={title.key === noun}>
                    {title.noun}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Wear this title
              </Button>
            </div>
          </form>
        )}

        <h2>
          Earned {earned.length} of {progress.length}
        </h2>
        <ul mix={listStyle}>
          {progress.map(({ title, current: count }) => {
            const isEarned = unlocked.has(title.key)
            return (
              <li key={title.key} mix={[itemStyle, isEarned ? earnedStyle : lockedStyle]}>
                <strong>
                  {title.adjective} · {title.noun}
                </strong>
                <span mix={css({ fontSize: '14px' })}>{title.requirement}</span>
                <span mix={metaStyle}>
                  {isEarned ? 'Earned' : `${Math.min(count, title.goal)} / ${title.goal}`}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }
}
