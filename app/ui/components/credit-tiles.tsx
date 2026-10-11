import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PART_NAMES, type TitleDefinition } from '../../data/profileTitles/catalog.ts'
import { routes } from '../../routes.ts'
import { Modal } from './modal.tsx'
import { Button, ToggleLabel } from '../shared/form-controls.tsx'

export interface Credit {
  title: TitleDefinition
  earned: boolean
  // How far along the member is. Only for their own credits: on someone else's
  // page it would read out their counts — how many things they've disliked,
  // say — which is more than their title chose to say.
  current?: number
}

// Set where the tiles are your own and tapping an earned one should put it on:
// what you wear now, and where to come back to afterwards.
export interface Picking {
  adjective: string | null
  noun: string | null
  returnTo: string
}

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  // Two columns, always: at three a word like "Watchlist Hoarder" wrapped onto
  // a second line. minmax(0, …) lets a column shrink below its longest word on
  // a phone, where the word is cut with an ellipsis rather than pushing the
  // grid wider than the screen.
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
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
  // Half a phone is narrow: smaller type and padding there keep the longest
  // words ("Watchlist Hoarder") whole in their column.
  '@media (max-width: 480px)': { padding: '8px', fontSize: '13px' },
  '@media (max-width: 400px)': { padding: '8px 6px', fontSize: '12px' },
})

// One line, so the grid reads as a list of words. Below 340px — the narrowest
// phones — a few of the longest don't fit half the screen even at the smaller
// size, and wrapping them beats cutting them off.
const wordStyle = css({
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  '@media (max-width: 340px)': { whiteSpace: 'normal' },
})

const lockedStyle = css({ borderStyle: 'dashed', color: 'var(--muted)' })

const earnedStyle = css({ borderLeft: '4px solid var(--accent)', background: 'var(--paper-tint)' })

// The one you're wearing: filled, so it stands out from the earned ones round it.
const wornStyle = css({
  borderColor: 'var(--accent)',
  background: 'var(--accent)',
  color: 'var(--paper)',
  '&:hover': { borderColor: 'var(--accent)' },
})

const tileButtonStyle = css({ display: 'block', width: '100%' })

// An earned tile you can wear: a form of its own posting the whole pair — this
// word in its slot, whatever you wear in the other — so the action is the same
// one, checked the same way, as when the pair came from two dropdowns. Tapping
// the one you're wearing takes it off.
function WearTile(handle: Handle<{ title: TitleDefinition; picking: Picking }>) {
  return () => {
    const { title, picking } = handle.props
    const slot = title.part
    const worn = picking[slot] === title.key
    const next = { ...picking, [slot]: worn ? null : title.key }
    const slotName = PART_NAMES[slot].one.toLowerCase()

    return (
      <form method="post" action={routes.profile.title.href()}>
        <input type="hidden" name="adjective" value={next.adjective ?? ''} />
        <input type="hidden" name="noun" value={next.noun ?? ''} />
        <input type="hidden" name="return_to" value={picking.returnTo} />
        <Button
          type="submit"
          variant="plain"
          aria-pressed={worn ? 'true' : 'false'}
          title={
            worn ? `Take off ${title.word}` : `Wear ${title.word} as your ${slotName} — ${title.requirement}`
          }
          mix={tileButtonStyle}
        >
          <span mix={[tileStyle, earnedStyle, worn ? wornStyle : undefined]}>
            <span mix={wordStyle}>
              <span aria-hidden="true">{worn ? '● ' : '✓ '}</span>
              {title.word}
            </span>
          </span>
        </Button>
      </form>
    )
  }
}

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

// One kind of credit, every one there is, as tiles carrying just the word. A
// tap opens a small modal saying what earns it and, on your own, how close you
// are — or, with `picking`, puts an earned one on — the list is for browsing the words, and thirty sentences at once buried
// them. Shared by the settings tab and the Titles tab on both profiles.
//
// Showing words before they're earned is deliberate: "Jump-Scared" is a better
// reason to watch ten horror films than a padlock is.
export function CreditTiles(handle: Handle<{ heading: string; credits: Credit[]; picking?: Picking }>) {
  return () => {
    const { heading, credits, picking } = handle.props
    const earnedCount = credits.filter((credit) => credit.earned).length

    return (
      <>
        <h2>
          {heading}{' '}
          <span mix={css({ fontSize: '14px', fontWeight: 400, color: 'var(--muted)' })}>
            {earnedCount} of {credits.length} earned
          </span>
        </h2>
        <ul mix={listStyle}>
          {credits.map(({ title, earned: isEarned, current }) => {
            const modalId = `credit-${title.key}`
            return (
              // Not a list-item: DoodleCSS gives every <li> a "* " marker,
              // unlayered, which beside a tile reads as a stray asterisk.
              <li key={title.key} mix={css({ display: 'block' })}>
                {picking && isEarned ? (
                  <WearTile title={title} picking={picking} />
                ) : (
                  <>
                    <ToggleLabel for={modalId} class="credit-tile">
                      <span mix={[tileStyle, isEarned ? earnedStyle : lockedStyle]}>
                        <span mix={wordStyle} title={title.word}>
                          {isEarned && <span aria-label="Earned">✓ </span>}
                          {title.word}
                        </span>
                        {!isEarned && current != null && <ProgressBar current={current} goal={title.goal} />}
                      </span>
                    </ToggleLabel>
                    <Modal id={modalId} title={title.word} small>
                      <p mix={css({ margin: '0 0 12px' })}>{title.requirement}.</p>
                      {isEarned ? (
                        <p mix={css({ margin: 0, color: 'var(--success)', fontWeight: 700 })}>✓ Earned</p>
                      ) : current != null ? (
                        <>
                          <ProgressBar current={current} goal={title.goal} />
                          <p mix={css({ margin: '6px 0 0', fontSize: '13px', color: 'var(--muted)' })}>
                            {Math.min(current, title.goal)} of {title.goal} so far
                          </p>
                        </>
                      ) : (
                        <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--muted)' })}>
                          Not earned yet
                        </p>
                      )}
                    </Modal>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </>
    )
  }
}

// Every credit there is, as genres then roles — what the Titles tab on a profile
// and in settings both show.
export function CreditGroups(handle: Handle<{ credits: Credit[]; picking?: Picking }>) {
  return () => {
    const { credits, picking } = handle.props
    return (
      <>
        <CreditTiles
          heading={PART_NAMES.adjective.many}
          credits={credits.filter((credit) => credit.title.part === 'adjective')}
          picking={picking}
        />
        <CreditTiles
          heading={PART_NAMES.noun.many}
          credits={credits.filter((credit) => credit.title.part === 'noun')}
          picking={picking}
        />
      </>
    )
  }
}

// The profile tab credits sit under, beside the media types, as it appears in
// the `?tab=` both profile pages read.
export const TITLES_TAB = 'titles'
