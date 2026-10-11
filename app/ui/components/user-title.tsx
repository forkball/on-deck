import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { titlesOfPart, type TitlePart } from '../../data/profileTitles/catalog.ts'
import { Modal } from './modal.tsx'
import { Link, ToggleLabel } from '../shared/form-controls.tsx'

const titleStyle = css({
  margin: '-12px 0 12px',
  fontStyle: 'italic',
  fontWeight: 600,
  color: 'var(--accent)',
})

const hintStyle = css({ fontStyle: 'normal', fontWeight: 400, fontSize: '14px' })

const MODAL_ID = 'user-title-words'

const PART_HEADINGS: Record<TitlePart, string> = { adjective: 'First words', noun: 'Second words' }

// What someone has earned, for the modal their title opens: each word with what
// earned it, since the word alone doesn't say whether "Stan" means ratings or
// follows.
function EarnedWords(handle: Handle<{ earned: ReadonlySet<string> }>) {
  return () => {
    const { earned } = handle.props

    return (
      <>
        {(['adjective', 'noun'] as const).map((part) => {
          const words = titlesOfPart(part).filter((title) => earned.has(title.key))
          if (words.length === 0) return null
          return (
            <section key={part} mix={css({ marginBottom: '12px' })}>
              <h4 mix={css({ margin: '0 0 6px', fontSize: '13px', color: 'var(--muted)' })}>
                {PART_HEADINGS[part]}
              </h4>
              <ul
                mix={css({
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                })}
              >
                {words.map((title) => (
                  // Not a list-item, so DoodleCSS's "* " marker stays off it.
                  <li key={title.key} mix={css({ display: 'block' })}>
                    <strong>{title.word}</strong>
                    <span mix={css({ display: 'block', fontSize: '12px', color: 'var(--muted)' })}>
                      {title.requirement}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </>
    )
  }
}

// The title a member wears, on the line under their name. Shared by the profile
// you see of yourself and the one other people see.
//
// On your own, `href` links it to where it is changed. On someone else's,
// `earned` makes it open a modal of every word they've earned — left off when
// their profile is private to you, since what they've earned says what they've
// logged. `margin` is for the page under it: the heading above isn't spaced the
// same on both profiles.
export function UserTitle(
  handle: Handle<{
    title: string | null
    href?: string
    earned?: ReadonlySet<string>
    // Whose words they are, for the modal's heading.
    ownerLabel?: string
    margin?: string
  }>,
) {
  return () => {
    const { title, href, earned, ownerLabel, margin } = handle.props
    const placed = margin ? css({ margin }) : undefined
    const canOpen = earned != null && earned.size > 0

    if (canOpen) {
      return (
        <div mix={[titleStyle, placed]}>
          <ToggleLabel for={MODAL_ID} class="title-trigger" tapArea>
            {title ?? (
              <span mix={hintStyle}>
                {earned.size} credit{earned.size === 1 ? '' : 's'} earned
              </span>
            )}
          </ToggleLabel>
          <div mix={css({ fontStyle: 'normal', fontWeight: 400, color: 'var(--text)' })}>
            <Modal id={MODAL_ID} title={ownerLabel ? `${ownerLabel}'s credits` : 'Credits'} small>
              <EarnedWords earned={earned} />
            </Modal>
          </div>
        </div>
      )
    }

    if (!title) {
      return href ? (
        <p mix={[titleStyle, hintStyle, placed]}>
          <Link href={href}>Earn yourself a title →</Link>
        </p>
      ) : null
    }

    return <p mix={[titleStyle, placed]}>{href ? <Link href={href}>{title}</Link> : title}</p>
  }
}
