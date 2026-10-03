import type { Handle } from 'remix/ui'
import { css, on } from 'remix/ui'
import { Button, CheckboxOption, ChoiceGroup, RadioOption, TextInput } from '../ui/shared/form-controls.tsx'

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
        <ChoiceGroup
          legend="Who's this for?"
          layout="row"
          hint={
            friends.length === 0 && (
              <>
                <a href={findPeopleHref}>Find and follow people</a> to build a group.
              </>
            )
          }
        >
          <RadioOption
            name="mode"
            value="self"
            defaultChecked={mode === 'self'}
            mix={on('change', () => onModeChange('self'))}
          >
            Just me
          </RadioOption>
          <RadioOption
            name="mode"
            value="group"
            defaultChecked={mode === 'group'}
            disabled={friends.length === 0}
            mix={on('change', () => onModeChange('group'))}
          >
            With friends
          </RadioOption>
        </ChoiceGroup>

        {friends.length === 0 ? null : (
          <div
            mix={css({
              display: mode === 'group' ? 'flex' : 'none',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '12px',
            })}
          >
            <TextInput
              placeholder="Search friends…"
              value={search}
              mix={on('input', (event) => onSearchChange((event.target as HTMLInputElement).value))}
            />

            {filtered.length === 0 && (
              <p mix={css({ margin: 0, fontSize: '13px', color: '#888' })}>No friends match "{search}".</p>
            )}

            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
              {friends.map((friend) => (
                <CheckboxOption
                  key={friend.id}
                  hidden={!visibleIds.has(friend.id)}
                  name="friend_ids"
                  value={String(friend.id)}
                  checked={selectedFriendIds.has(friend.id)}
                  mix={on('change', (event) =>
                    onToggleFriend(friend.id, (event.target as HTMLInputElement).checked),
                  )}
                >
                  {friend.label}
                </CheckboxOption>
              ))}
            </div>

            {totalPages > 1 && (
              <div mix={css({ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' })}>
                <Button
                  type="button"
                  disabled={clampedPage <= 1}
                  mix={on('click', () => onPageChange(Math.max(1, clampedPage - 1)))}
                >
                  ← Prev
                </Button>
                <span mix={css({ color: '#888' })}>
                  Page {clampedPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  disabled={clampedPage >= totalPages}
                  mix={on('click', () => onPageChange(Math.min(totalPages, clampedPage + 1)))}
                >
                  Next →
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
}
