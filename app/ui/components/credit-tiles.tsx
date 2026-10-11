import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import {
  GENRE_GROUPS,
  MEDIA_GROUPS,
  PART_NAMES,
  type TitleDefinition,
} from '../../data/profileTitles/catalog.ts'
import { routes } from '../../routes.ts'
import { Modal } from './modal.tsx'
import { Field } from '../shared/field.tsx'
import { Button, ChoiceGroup, RadioOption, Select, ToggleLabel } from '../shared/form-controls.tsx'

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

// Puts an earned credit on, or takes off the one you're wearing: a form
// posting the whole pair — this word in its slot, whatever you wear in the
// other — so the action is the same one, checked the same way, as when the
// pair came from two dropdowns.
function WearForm(handle: Handle<{ title: TitleDefinition; picking: Picking }>) {
  return () => {
    const { title, picking } = handle.props
    const slot = title.part
    const worn = picking[slot] === title.key
    const next = { ...picking, [slot]: worn ? null : title.key }
    const slotName = PART_NAMES[slot].one.toLowerCase()

    return (
      <form method="post" action={routes.profile.title.href()} mix={css({ marginTop: '16px' })}>
        <input type="hidden" name="adjective" value={next.adjective ?? ''} />
        <input type="hidden" name="noun" value={next.noun ?? ''} />
        <input type="hidden" name="return_to" value={picking.returnTo} />
        <Button type="submit" variant={worn ? 'default' : 'primary'}>
          {worn ? 'Take it off' : `Wear as your ${slotName}`}
        </Button>
      </form>
    )
  }
}

// What earns a credit, and how far along you are or that you have it. Opened by
// any tile; on your own earned ones it is also where you put the credit on.
function CreditModal(
  handle: Handle<{
    id: string
    title: TitleDefinition
    earned: boolean
    current?: number
    picking?: Picking
  }>,
) {
  return () => {
    const { id, title, earned, current, picking } = handle.props
    const worn = picking != null && picking[title.part] === title.key
    return (
      <Modal id={id} title={title.word} small closeOnOutsideTap>
        <p mix={css({ margin: '0 0 12px' })}>{title.requirement}.</p>
        {earned ? (
          <p mix={css({ margin: 0, color: 'var(--success)', fontWeight: 700 })}>
            {worn ? `● Earned — you're wearing it` : '✓ Earned'}
          </p>
        ) : current != null ? (
          <>
            <ProgressBar current={current} goal={title.goal} />
            <p mix={css({ margin: '6px 0 0', fontSize: '13px', color: 'var(--muted)' })}>
              {Math.min(current, title.goal)} of {title.goal} so far
            </p>
          </>
        ) : (
          <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--muted)' })}>Not earned yet</p>
        )}
        {earned && picking && <WearForm title={title} picking={picking} />}
      </Modal>
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
// are — and, with `picking`, a button there to wear an earned one. The list is
// for browsing the words; thirty sentences at once buried them. Shared by the settings tab and the Titles tab on both profiles.
//
// Showing words before they're earned is deliberate: "Jump-Scared" is a better
// reason to watch ten horror films than a padlock is.
export function CreditTiles(handle: Handle<{ heading: string; credits: Credit[]; picking?: Picking }>) {
  return () => {
    const { heading, credits, picking } = handle.props
    const earnedCount = credits.filter((credit) => credit.earned).length

    return (
      <section class="credit-section">
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
              // Its display is set by CreditGroups' filter style, alongside the
              // rules that hide it — see filterStyle.
              <li
                key={title.key}
                class="credit"
                data-group={groupSlug(title.group)}
                data-earned={String(isEarned)}
              >
                <ToggleLabel for={modalId} class="credit-tile">
                  <span
                    mix={[
                      tileStyle,
                      isEarned ? earnedStyle : lockedStyle,
                      picking && picking[title.part] === title.key ? wornStyle : undefined,
                    ]}
                  >
                    <span mix={wordStyle} title={title.word}>
                      {isEarned && (
                        <span aria-label="Earned">
                          {picking && picking[title.part] === title.key ? '● ' : '✓ '}
                        </span>
                      )}
                      {title.word}
                    </span>
                    {!isEarned && current != null && <ProgressBar current={current} goal={title.goal} />}
                  </span>
                </ToggleLabel>
                <CreditModal
                  id={modalId}
                  title={title}
                  earned={isEarned}
                  current={current}
                  picking={picking}
                />
              </li>
            )
          })}
        </ul>
      </section>
    )
  }
}

type CSSStyle = Parameters<typeof css>[0]

// A group's name as it sits in a data attribute and an option value.
function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

const STATUSES = [
  { value: 'all', label: 'All', earned: null },
  { value: 'earned', label: 'Earned', earned: 'true' },
  { value: 'unearned', label: 'Still to earn', earned: 'false' },
] as const

// The filter, in CSS: `:has()` reads which status radio and which group
// option are checked, and hides the tiles that don't match — the same way
// tabs.tsx switches panels, so it is instant and needs nothing to run in the
// browser. A section left with no matching tile goes too, and the "nothing
// matches" line shows when every section has.
//
// One style object, the tile's own `display` included: separate css() calls
// land in @layers ordered by declaration rather than specificity, so a hide
// rule in another call could lose to it.
function filterStyle(groups: string[]): CSSStyle {
  const style: Record<string, unknown> = {
    // Not a list-item: DoodleCSS gives every <li> a "* " marker, unlayered,
    // which beside a tile reads as a stray asterisk.
    '& li.credit': { display: 'block' },
    '& .no-match': { display: 'none' },
  }
  const status = (value: string) => `:has(input[name="credit-status"][value="${value}"]:checked)`
  const group = (slug: string) => `:has(select[name="credit-group"] option[value="${slug}"]:checked)`

  for (const { value, earned } of STATUSES) {
    if (earned) style[`&${status(value)} li.credit:not([data-earned="${earned}"])`] = { display: 'none' }
  }
  for (const slug of groups) {
    style[`&${group(slug)} li.credit:not([data-group="${slug}"])`] = { display: 'none' }
  }
  for (const { value, earned } of STATUSES) {
    for (const slug of ['', ...groups]) {
      const match = `li.credit${slug ? `[data-group="${slug}"]` : ''}${earned ? `[data-earned="${earned}"]` : ''}`
      if (!slug && !earned) continue
      const when = `&${status(value)}${slug ? group(slug) : ''}`
      style[`${when} .credit-section:not(:has(${match}))`] = { display: 'none' }
      style[`${when}:not(:has(${match})) .no-match`] = { display: 'block' }
    }
  }
  return style as CSSStyle
}

const filterBarStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '8px 24px',
  margin: '16px 0 0',
})

// Every credit there is, as genres then roles — what the Titles tab on a profile
// and in settings both show — with a filter by what earns them and by whether
// they're earned yet.
export function CreditGroups(handle: Handle<{ credits: Credit[]; picking?: Picking }>) {
  return () => {
    const { credits, picking } = handle.props
    const groups = [...new Set(credits.map((credit) => credit.title.group))]
    // Forty-odd groups in one list is a lot to scan, so the dropdown splits
    // them: genres alphabetically, then the media, then everything else in
    // catalog order.
    const optionGroups = [
      {
        label: 'Genres',
        groups: groups
          .filter((group) => GENRE_GROUPS.has(group))
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
      },
      { label: 'Media', groups: groups.filter((group) => MEDIA_GROUPS.has(group)) },
      {
        label: 'Everything else',
        groups: groups.filter((group) => !GENRE_GROUPS.has(group) && !MEDIA_GROUPS.has(group)),
      },
    ]

    return (
      <div mix={css(filterStyle(groups.map(groupSlug)))}>
        <div mix={filterBarStyle}>
          <Field label="What earns them">
            <Select name="credit-group">
              <option value="" selected>
                Everything
              </option>
              {optionGroups.map(({ label, groups: members }) => (
                <optgroup key={label} label={label}>
                  {members.map((group) => (
                    <option key={group} value={groupSlug(group)}>
                      {group}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {/* Stacked: in a row, "Still to earn" wrapped onto a line of its
              own on a phone and read as a separate choice. */}
          <ChoiceGroup legend="Show">
            {STATUSES.map(({ value, label }) => (
              <RadioOption key={value} name="credit-status" value={value} defaultChecked={value === 'all'}>
                {label}
              </RadioOption>
            ))}
          </ChoiceGroup>
        </div>
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
        <p class="no-match" mix={css({ color: 'var(--muted)', marginTop: '24px' })}>
          Nothing matches that filter.
        </p>
      </div>
    )
  }
}

// The profile tab credits sit under, beside the media types, as it appears in
// the `?tab=` both profile pages read.
export const TITLES_TAB = 'titles'
