import { clientEntry, css, on } from 'remix/ui'

export type FriendOption = {
  id: number
  label: string
}

export type GenerateRecommendationsFormProps = {
  friends: FriendOption[]
  generateHref: string
  findPeopleHref: string
}

// The only client-hydrated component in the app — everything else is
// CSS-only. Generating recommendations is a genuine multi-second wait (a few
// Claude calls plus TMDB lookups), so this shows a "Generating…" state the
// instant you submit. The <form> still works as a plain POST without JS;
// this only adds feedback on top.
//
// URLs come in as plain string props rather than importing routes.ts — the
// asset server only allows bundling files under app/assets/**, and routes.ts
// lives outside that.
export const GenerateRecommendationsForm = clientEntry<GenerateRecommendationsFormProps>(
  import.meta.url,
  function GenerateRecommendationsForm(handle) {
    let submitting = false

    return () => {
      const { friends, generateHref, findPeopleHref } = handle.props

      return (
        <form
          method="post"
          action={generateHref}
          mix={[
            css({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <label>
            <input type="radio" name="mode" value="self" defaultChecked /> Just me
          </label>
          <label>
            <input type="radio" name="mode" value="group" disabled={friends.length === 0} /> With friends
          </label>

          {friends.length > 0 ? (
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '24px' })}>
              {friends.map((friend) => (
                <label key={friend.id}>
                  <input type="checkbox" name="friend_ids" value={String(friend.id)} /> {friend.label}
                </label>
              ))}
            </div>
          ) : (
            <p mix={css({ margin: 0, paddingLeft: '24px', fontSize: '13px', color: '#888' })}>
              <a href={findPeopleHref}>Find and follow people</a> to build a group.
            </p>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Generating…' : 'Get recommendations'}
          </button>
        </form>
      )
    }
  },
)
