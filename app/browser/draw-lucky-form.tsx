import { clientEntry, css, on } from 'remix/ui'

export type LuckyFriendOption = {
  id: number
  label: string
  loggedTypes: string[]
}

export type DrawLuckyFormProps = {
  friends: LuckyFriendOption[]
  viewerLoggedTypes: string[]
  mediaType: string
  // Singular noun for one of them — "movie", "TV show", "book", "game".
  itemNoun: string
  drawHref: string
  findPeopleHref: string
}

const FRIENDS_PAGE_SIZE = 8

// The "who's this for" half of GenerateRecommendationsForm, on its own: a
// lucky draw reads no other lever, so the rest of that form — the shortlist
// radio, settings, filters — would only be things to skip past here. Some of
// this (the radio look, the friend search/paging) is a copy of that form's
// rather than a shared import, because a client entry can only pull in
// app/browser/** and app/ui/shared/**, and the two forms are small enough
// that splitting a third module out for one shared fragment would cost more
// than it saves.
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

      const query = search.trim().toLowerCase()
      const filtered = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends
      const totalPages = Math.max(1, Math.ceil(filtered.length / FRIENDS_PAGE_SIZE))
      if (page > totalPages) page = totalPages
      const start = (page - 1) * FRIENDS_PAGE_SIZE
      const visibleIds = new Set(filtered.slice(start, start + FRIENDS_PAGE_SIZE).map((friend) => friend.id))

      const radioRow = css({ display: 'flex', alignItems: 'center', gap: '8px', lineHeight: 1 })
      const radioInput = css({ margin: 0 })
      const radioLabelText = css({ position: 'relative', top: '0.05em' })

      const sectionLabel = css({
        margin: '0 0 10px',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: '#888',
      })

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
          <div>
            <p mix={sectionLabel}>Who's this for?</p>
            <div mix={css({ display: 'flex', gap: '20px' })}>
              <label>
                <span mix={radioRow}>
                  <input
                    type="radio"
                    name="mode"
                    value="self"
                    defaultChecked={true}
                    mix={[
                      radioInput,
                      on('change', () => {
                        mode = 'self'
                        handle.update()
                      }),
                    ]}
                  />
                  <span mix={radioLabelText}>Just me</span>
                </span>
              </label>
              <label>
                <span mix={radioRow}>
                  <input
                    type="radio"
                    name="mode"
                    value="group"
                    disabled={friends.length === 0}
                    mix={[
                      radioInput,
                      on('change', () => {
                        mode = 'group'
                        handle.update()
                      }),
                    ]}
                  />
                  <span mix={radioLabelText}>With friends</span>
                </span>
              </label>
            </div>

            {friends.length === 0 ? (
              <p mix={css({ margin: '8px 0 0', fontSize: '13px', color: '#888' })}>
                <a href={findPeopleHref}>Find and follow people</a> to draw for a group.
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
                  mix={on('input', (event) => {
                    search = (event.target as HTMLInputElement).value
                    page = 1
                    handle.update()
                  })}
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
                        checked={selectedFriends.has(friend.id)}
                        mix={on('change', (event) => {
                          if ((event.target as HTMLInputElement).checked) selectedFriends.add(friend.id)
                          else selectedFriends.delete(friend.id)
                          handle.update()
                        })}
                      />{' '}
                      {friend.label}
                    </label>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div mix={css({ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' })}>
                    <button
                      type="button"
                      disabled={page <= 1}
                      mix={on('click', () => {
                        page = Math.max(1, page - 1)
                        handle.update()
                      })}
                    >
                      ← Prev
                    </button>
                    <span mix={css({ color: '#888' })}>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      mix={on('click', () => {
                        page = Math.min(totalPages, page + 1)
                        handle.update()
                      })}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <input type="hidden" name="mediaType" value={mediaType} />

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
