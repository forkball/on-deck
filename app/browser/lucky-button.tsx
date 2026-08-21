import { clientEntry, css, on } from 'remix/ui'

export type LuckyFriendOption = {
  id: number
  label: string
  // Whether this person has anything logged of the type being drawn. The run
  // needs a taste profile per member, and an empty log yields an empty one.
  hasLogged: boolean
}

export type LuckyButtonProps = {
  luckyHref: string
  mediaType: string
  // The medium as it reads mid-sentence — "movie", "TV", "book", "game".
  mediaTypeLabel: string
  // Singular noun for the thing being drawn — "movie", "TV show", "book", "game".
  itemNoun: string
  friends: LuckyFriendOption[]
  viewerHasLogged: boolean
  // False once the day's pick has been drawn. The button still renders, greyed,
  // so the cap is visible before it is hit rather than after.
  available: boolean
  // How long until the next draw, already phrased ("about 7 hours"). Only set
  // when `available` is false.
  waitLabel: string
  findPeopleHref: string
}

// One click, one pick. The only choice on offer starts collapsed, because the
// whole point of the button is not having to make one.
//
// URLs arrive as plain string props: the browser bundle is limited to
// app/browser/**, and the route table lives outside it.
export const LuckyButton = clientEntry<LuckyButtonProps>(
  import.meta.url,
  function LuckyButton(handle) {
    let submitting = false
    let withFriends = false
    let search = ''
    const selected = new Set<number>()

    return () => {
      const {
        luckyHref,
        mediaType,
        mediaTypeLabel,
        itemNoun,
        friends,
        viewerHasLogged,
        available,
        waitLabel,
        findPeopleHref,
      } = handle.props

      const query = search.trim().toLowerCase()
      const shown = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends

      // Same rule the pipeline enforces, applied here so nobody spends the day's
      // draw finding it out.
      const blocked = [
        ...(viewerHasLogged ? [] : ['You have']),
        ...friends
          .filter((friend) => selected.has(friend.id) && !friend.hasLogged)
          .map((friend) => `${friend.label} has`),
      ]

      const disabled = submitting || !available || blocked.length > 0

      return (
        <form
          method="post"
          action={luckyHref}
          mix={[
            css({
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }),
            on('submit', (event) => {
              if (disabled) {
                event.preventDefault()
                return
              }
              submitting = true
              handle.update()
            }),
          ]}
        >
          <input type="hidden" name="mediaType" value={mediaType} />

          <div mix={css({ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' })}>
            <button type="submit" disabled={disabled}>
              {submitting ? 'Drawing…' : `🎲 I'm feeling lucky`}
            </button>

            {/* A real button rather than a link dressed as one: the app's
                stylesheet is unlayered, so a component's own rules cannot take
                the frame back off one. Sitting beside the primary, at the same
                weight, it reads as the other half of one choice. */}
            {available && friends.length > 0 && (
              <button
                type="button"
                mix={on('click', () => {
                  withFriends = !withFriends
                  handle.update()
                })}
              >
                {selected.size > 0
                  ? `you + ${selected.size} other${selected.size === 1 ? '' : 's'}`
                  : withFriends
                    ? 'just me'
                    : 'or for a group…'}
              </button>
            )}
          </div>

          <p mix={css({ margin: 0, fontSize: '13px', color: '#888' })}>
            {available
              ? `One ${itemNoun} nobody in the draw has logged, straight from your ${mediaTypeLabel} taste. No filters, no picking — once a day.`
              : `Today's pick is drawn. Another one in ${waitLabel}.`}
          </p>

          {blocked.length > 0 && (
            <p mix={css({ margin: 0, fontSize: '13px', color: '#b91c1c' })}>
              {blocked.join(', and ')} nothing logged to draw from.
            </p>
          )}

          {available && friends.length === 0 && (
            <p mix={css({ margin: 0, fontSize: '13px', color: '#888' })}>
              <a href={findPeopleHref}>Follow someone</a> to draw for a group instead.
            </p>
          )}

          {available && friends.length > 0 && (
            <div
              mix={css({
                display: withFriends ? 'flex' : 'none',
                flexDirection: 'column',
                gap: '6px',
              })}
            >
              {friends.length > 6 && (
                <input
                  type="text"
                  placeholder="Search people…"
                  value={search}
                  mix={on('input', (event) => {
                    search = (event.target as HTMLInputElement).value
                    handle.update()
                  })}
                />
              )}

              {/* Every checkbox stays mounted and only its visibility toggles,
                  so searching can't silently drop a selection made before the
                  box was typed in. */}
              <div
                mix={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  maxHeight: '180px',
                  overflowY: 'auto',
                })}
              >
                {friends.map((friend) => (
                  <label
                    key={friend.id}
                    mix={css({
                      display: shown.some((match) => match.id === friend.id) ? 'block' : 'none',
                      fontSize: '14px',
                      color: friend.hasLogged ? 'inherit' : '#888',
                    })}
                  >
                    <input
                      type="checkbox"
                      name="friend_ids"
                      value={String(friend.id)}
                      checked={selected.has(friend.id)}
                      mix={on('change', (event) => {
                        if ((event.target as HTMLInputElement).checked) selected.add(friend.id)
                        else selected.delete(friend.id)
                        handle.update()
                      })}
                    />{' '}
                    {friend.label}
                    {!friend.hasLogged && <span mix={css({ fontSize: '12px' })}> — nothing logged</span>}
                  </label>
                ))}

                {shown.length === 0 && (
                  <p mix={css({ margin: 0, fontSize: '13px', color: '#888' })}>Nobody matches "{search}".</p>
                )}
              </div>
            </div>
          )}
        </form>
      )
    }
  },
)
