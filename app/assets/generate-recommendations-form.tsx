import { clientEntry, css, on } from 'remix/ui'

import { Collapsible } from './lib/collapsible.tsx'
import { Field } from './lib/field.tsx'

export type FriendOption = {
  id: number
  label: string
}

export type GenerateRecommendationsFormProps = {
  friends: FriendOption[]
  // Which media type this run generates for — set by the page's tabs, not
  // chosen in this form, so it's just carried through as a hidden field.
  // Plain strings rather than the shared media-type registry: this file is a
  // clientEntry island, and the asset server only bundles app/assets/**, so
  // anything outside that has to arrive as a serializable prop.
  mediaType: string
  // e.g. "movie" / "TV" — used attributively in "you'll still get X picks".
  mediaTypeLabel: string
  // Taste profiles that can feed a run, computed server-side from the media
  // type registry — the island can't import it (asset bundle boundary), so
  // they arrive as plain data.
  sources: { value: string; label: string }[]
  genres: string[]
  generateHref: string
  findPeopleHref: string
}

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

// Taste profiles that don't exist yet — shown so the picker reads as
// "more coming" rather than movies/TV being the permanent ceiling.
const PLACEHOLDER_SOURCES = ['Games']

// Cycled through on the submit button while a run is generating, so the wait
// reads as progress rather than a stall.
const THINKING_MESSAGES = [
  'Generating…',
  'Reading taste profiles…',
  'Asking Claude for picks…',
  'Matching results…',
  'Almost there…',
]

const FRIENDS_PAGE_SIZE = 8

// The only client-hydrated component in the app — everything else is
// CSS-only. Generating recommendations is a genuine multi-second wait (a few
// Claude calls plus TMDB lookups), so this shows a "Generating…" state the
// instant you submit, cycling through THINKING_MESSAGES for as long as the
// wait continues. The <form> still works as a plain POST without JS; this
// only adds feedback on top.
//
// The friend picker is search-filtered and paginated client-side (the
// server hands over the full list once). Every friend's checkbox always
// stays mounted — only its visibility toggles — so a selection made before
// searching/paging away never gets silently dropped from the submitted form.
//
// URLs come in as plain string props rather than importing routes.ts — the
// asset server only allows bundling files under app/assets/**, and routes.ts
// lives outside that.
export const GenerateRecommendationsForm = clientEntry<GenerateRecommendationsFormProps>(
  import.meta.url,
  function GenerateRecommendationsForm(handle) {
    let submitting = false
    let thinkingIndex = 0
    let mode: 'self' | 'group' = 'self'
    let search = ''
    let page = 1
    // Defaults to the type being generated: the common case is "books from
    // my book taste", with cross-media sourcing as the deliberate opt-in.
    const selectedSources = new Set<string>([handle.props.mediaType])

    return () => {
      const { friends, mediaType, mediaTypeLabel, sources, genres, generateHref, findPeopleHref } = handle.props
      const hasSource = selectedSources.size > 0

      const query = search.trim().toLowerCase()
      const filtered = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends
      const totalPages = Math.max(1, Math.ceil(filtered.length / FRIENDS_PAGE_SIZE))
      if (page > totalPages) page = totalPages
      const start = (page - 1) * FRIENDS_PAGE_SIZE
      const visibleIds = new Set(filtered.slice(start, start + FRIENDS_PAGE_SIZE).map((friend) => friend.id))

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
          action={generateHref}
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

              const interval = setInterval(() => {
                if (handle.signal.aborted) {
                  clearInterval(interval)
                  return
                }
                thinkingIndex = (thinkingIndex + 1) % THINKING_MESSAGES.length
                handle.update()
              }, 1800)
            }),
          ]}
        >
          <Field label="Name this run (optional)">
            <input type="text" name="name" placeholder="e.g. Cozy weekend picks" />
          </Field>

          <div>
            <p mix={sectionLabel}>Who's this for?</p>
            <div mix={css({ display: 'flex', gap: '20px' })}>
              <label>
                <input
                  type="radio"
                  name="mode"
                  value="self"
                  defaultChecked
                  mix={on('change', () => {
                    mode = 'self'
                    handle.update()
                  })}
                />{' '}
                Just me
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  value="group"
                  disabled={friends.length === 0}
                  mix={on('change', () => {
                    mode = 'group'
                    handle.update()
                  })}
                />{' '}
                With friends
              </label>
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
                    <label
                      key={friend.id}
                      mix={css({ display: visibleIds.has(friend.id) ? 'block' : 'none' })}
                    >
                      <input type="checkbox" name="friend_ids" value={String(friend.id)} /> {friend.label}
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

          {/* Which type this run is for is set by the page's tabs, not here
              — carried through as a hidden field so the POST still says so. */}
          <input type="hidden" name="mediaType" value={mediaType} />

          <div mix={css({ borderTop: '1px solid #eee', paddingTop: '16px' })}>
            <p mix={sectionLabel}>Base picks on</p>
            <div mix={css({ display: 'flex', gap: '20px', flexWrap: 'wrap' })}>
              {sources.map((source) => (
                <label key={source.value}>
                  <input
                    type="checkbox"
                    name="source"
                    value={source.value}
                    checked={selectedSources.has(source.value)}
                    mix={on('change', (event) => {
                      if ((event.target as HTMLInputElement).checked) selectedSources.add(source.value)
                      else selectedSources.delete(source.value)
                      handle.update()
                    })}
                  />{' '}
                  {source.label}
                </label>
              ))}
              {PLACEHOLDER_SOURCES.map((label) => (
                <label key={label} mix={css({ color: '#aaa' })}>
                  <input type="checkbox" disabled /> {label}{' '}
                  <span mix={css({ fontStyle: 'italic', fontSize: '12px' })}>(soon)</span>
                </label>
              ))}
            </div>
            {hasSource ? (
              <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#888' })}>
                You'll still get {mediaTypeLabel} picks — this only changes which taste they're
                drawn from.
              </p>
            ) : (
              <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#b91c1c' })}>
                Pick at least one taste to base picks on.
              </p>
            )}
          </div>

          <div mix={css({ borderTop: '1px solid #eee', paddingTop: '16px' })}>
            <Collapsible summary={<span mix={sectionLabel}>Filters (optional)</span>}>
            <div
              mix={css({
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: '12px',
              })}
            >
              <Field label="Genre">
                <select name="genre" defaultValue="">
                  <option value="">Any</option>
                  {genres.map((genre) => (
                    <option value={genre}>{genre.replace(/^./, (c) => c.toUpperCase())}</option>
                  ))}
                </select>
              </Field>
              <Field label="Decade">
                <select name="decade" defaultValue="">
                  <option value="">Any</option>
                  {DECADES.map((decade) => (
                    <option key={decade} value={String(decade)}>
                      {decade}s
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Length">
                <select name="length" defaultValue="">
                  <option value="">Any</option>
                  <option value="short">Under 90 min</option>
                  <option value="medium">90–150 min</option>
                  <option value="long">Over 150 min</option>
                </select>
              </Field>
            </div>
            </Collapsible>
          </div>

          <button type="submit" disabled={submitting || !hasSource}>
            {submitting ? THINKING_MESSAGES[thinkingIndex] : 'Get recommendations'}
          </button>
        </form>
      )
    }
  },
)
