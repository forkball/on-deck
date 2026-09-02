import { clientEntry, css, on } from 'remix/ui'

import { FriendPicker, type FriendOption } from './friend-picker.tsx'

// Tells the shared `lucky` action which page a submission came from, so a
// failure re-renders that page rather than the general recommendations one.
// Exported for the controller to read back rather than repeating the literal.
export const LUCKY_PAGE_ORIGIN = 'lucky_page'

export type DrawLuckyFormProps = {
  friends: FriendOption[]
  viewerLoggedTypes: string[]
  mediaType: string
  // Singular noun for one of them — "movie", "TV show", "book", "game".
  itemNoun: string
  drawHref: string
  findPeopleHref: string
}

// The "who's this for" half of GenerateRecommendationsForm, on its own: a
// lucky draw reads no other lever, so the rest of that form has nothing here
// to skip past.
export const DrawLuckyForm = clientEntry<DrawLuckyFormProps>(
  import.meta.url,
  function DrawLuckyForm(handle) {
    let submitting = false
    let mode: 'self' | 'group' = 'self'
    let search = ''
    let page = 1
    const selectedFriends = new Set<number>()

    return () => {
      const { friends, viewerLoggedTypes, mediaType, itemNoun, drawHref, findPeopleHref } = handle.props

      const membersInRun = [
        { label: 'You', loggedTypes: viewerLoggedTypes },
        ...(mode === 'group' ? friends.filter((friend) => selectedFriends.has(friend.id)) : []),
      ]
      const blockedBy = membersInRun.filter((member) => !member.loggedTypes.includes(mediaType))
      const disabled = submitting || blockedBy.length > 0

      return (
        <form
          method="post"
          action={drawHref}
          mix={[
            css({
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              width: '100%',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '20px',
            }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <FriendPicker
            friends={friends}
            mode={mode}
            onModeChange={(next) => {
              mode = next
              handle.update()
            }}
            selectedFriendIds={selectedFriends}
            onToggleFriend={(id, checked) => {
              if (checked) selectedFriends.add(id)
              else selectedFriends.delete(id)
              handle.update()
            }}
            search={search}
            onSearchChange={(value) => {
              search = value
              page = 1
              handle.update()
            }}
            page={page}
            onPageChange={(next) => {
              page = next
              handle.update()
            }}
            findPeopleHref={findPeopleHref}
          />

          <input type="hidden" name="mediaType" value={mediaType} />
          <input type="hidden" name="origin" value={LUCKY_PAGE_ORIGIN} />

          {blockedBy.length > 0 && (
            <p mix={css({ margin: 0, fontSize: '13px', color: '#b91c1c' })}>
              {blockedBy.map((member) => member.label).join(', ')}{' '}
              {blockedBy.length === 1 && blockedBy[0].label === 'You' ? 'have' : 'has'} nothing {itemNoun} logged
              to draw from.
            </p>
          )}

          <button type="submit" disabled={disabled} mix={css({ minHeight: '44px', width: '100%' })}>
            {submitting ? 'Drawing…' : `🎲 Draw today's pick`}
          </button>
        </form>
      )
    }
  },
)
