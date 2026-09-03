import type { Handle } from 'remix/ui'
import { css, on } from 'remix/ui'

export type FriendOption = {
  id: number
  label: string
  loggedTypes: string[]
}

export const sectionLabel = css({
  margin: '0 0 10px',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#888',
})

// Flex does the aligning, but it has to live on a span rather than the label:
// DoodleCSS sets `.doodle label { display: inline-block }` unlayered, which
// beats a layered css() rule at any specificity, so a flex label is silently
// dropped. Centring puts the radio's ring on the row's centre line — the
// hand-drawn ring is a border-image painted across the whole input box.
const radioRow = css({ display: 'flex', alignItems: 'center', gap: '8px', lineHeight: 1 })
// The browser's own radio margin isn't symmetric top/bottom, which leaves the
// control sitting low once centred by flex — zeroed so the ring lands where
// flex actually put it.
const radioInput = css({ margin: 0 })
// Letters don't sit centred in their own line box; nudged down in em so it
// survives a change of type scale.
const radioLabelText = css({ position: 'relative', top: '0.05em' })

// The one radio look used across the recommendations forms.
export function radioOption(props: {
  name: string
  value: string
  checked?: boolean
  disabled?: boolean
  onChange: () => void
  children: string
}) {
  return (
    <label>
      <span mix={radioRow}>
        <input
          type="radio"
          name={props.name}
          value={props.value}
          disabled={props.disabled}
          defaultChecked={props.checked}
          mix={[radioInput, on('change', props.onChange)]}
        />
        <span mix={radioLabelText}>{props.children}</span>
      </span>
    </label>
  )
}

const FRIENDS_PAGE_SIZE = 8

export interface FriendPickerProps {
  friends: FriendOption[]
  mode: 'self' | 'group'
  onModeChange: (mode: 'self' | 'group') => void
  selectedFriendIds: Set<number>
  onToggleFriend: (id: number, checked: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  page: number
  onPageChange: (page: number) => void
  findPeopleHref: string
}

// "Who's this for" — self, or a searchable, paged group of friends. Shared by
// the shortlist and lucky-draw forms, the only two levers a lucky draw reads.
//
// Filters and pages client-side, but every checkbox stays mounted and only
// its visibility toggles, so a selection made before paging away isn't lost.
export function FriendPicker(handle: Handle<FriendPickerProps>) {
  return () => {
    const {
      friends,
      mode,
      onModeChange,
      selectedFriendIds,
      onToggleFriend,
      search,
      onSearchChange,
      page,
      onPageChange,
      findPeopleHref,
    } = handle.props

    const query = search.trim().toLowerCase()
    const filtered = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends
    const totalPages = Math.max(1, Math.ceil(filtered.length / FRIENDS_PAGE_SIZE))
    const clampedPage = Math.min(page, totalPages)
    const start = (clampedPage - 1) * FRIENDS_PAGE_SIZE
    const visibleIds = new Set(filtered.slice(start, start + FRIENDS_PAGE_SIZE).map((friend) => friend.id))

    return (
      <div>
        <p mix={sectionLabel}>Who's this for?</p>
        <div mix={css({ display: 'flex', gap: '20px' })}>
          {radioOption({
            name: 'mode',
            value: 'self',
            checked: mode === 'self',
            onChange: () => onModeChange('self'),
            children: 'Just me',
          })}
          {radioOption({
            name: 'mode',
            value: 'group',
            checked: mode === 'group',
            disabled: friends.length === 0,
            onChange: () => onModeChange('group'),
            children: 'With friends',
          })}
        </div>

        {friends.length === 0 ? (
          <p mix={css({ margin: '8px 0 0', fontSize: '13px', color: '#888' })}>
            <a href={findPeopleHref}>Find and follow people</a> to build a group.
          </p>
        ) : (
          <div
            mix={css({
              display: mode === 'group' ? 'flex' : 'none',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '12px',
            })}
          >
            <input
              type="text"
              placeholder="Search friends…"
              value={search}
              mix={on('input', (event) => onSearchChange((event.target as HTMLInputElement).value))}
            />

            {filtered.length === 0 && (
              <p mix={css({ margin: 0, fontSize: '13px', color: '#888' })}>No friends match "{search}".</p>
            )}

            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
              {friends.map((friend) => (
                <label key={friend.id} mix={css({ display: visibleIds.has(friend.id) ? 'block' : 'none' })}>
                  <input
                    type="checkbox"
                    name="friend_ids"
                    value={String(friend.id)}
                    checked={selectedFriendIds.has(friend.id)}
                    mix={on('change', (event) =>
                      onToggleFriend(friend.id, (event.target as HTMLInputElement).checked),
                    )}
                  />{' '}
                  {friend.label}
                </label>
              ))}
            </div>

            {totalPages > 1 && (
              <div mix={css({ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' })}>
                <button
                  type="button"
                  disabled={clampedPage <= 1}
                  mix={on('click', () => onPageChange(Math.max(1, clampedPage - 1)))}
                >
                  ← Prev
                </button>
                <span mix={css({ color: '#888' })}>
                  Page {clampedPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={clampedPage >= totalPages}
                  mix={on('click', () => onPageChange(Math.min(totalPages, clampedPage + 1)))}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
}
