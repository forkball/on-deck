import { clientEntry, css, on } from 'remix/ui'

import { Field } from '../ui/shared/field.tsx'

export type FriendOption = {
  id: number
  label: string
  loggedTypes: string[]
}

export type GenerateRecommendationsFormProps = {
  friends: FriendOption[]
  viewerLoggedTypes: string[]
  mediaType: string
  mediaTypeLabel: string
  sources: { value: string; label: string }[]
  genres: string[]
  lengthOptions: { value: string; label: string }[]
  playerTypes: string[]
  multiplayerTypes: string[]
  platforms: string[]
  seriesTypes: string[]
  generateHref: string
  findPeopleHref: string
}

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

const PLAYER_TYPE_LABELS: Record<string, string> = { singleplayer: 'Singleplayer', multiplayer: 'Multiplayer' }
const MULTIPLAYER_TYPE_LABELS: Record<string, string> = { coop: 'Co-op', versus: 'Versus' }
const SERIES_TYPE_LABELS: Record<string, string> = { series: 'Part of a series', standalone: 'Standalone' }

const PLACEHOLDER_SOURCES: string[] = []

const FRIENDS_PAGE_SIZE = 8

// Submitting redirects almost immediately to a page reporting the real stage, so
// this only covers that hop: the button disables itself so a second submit can't
// start a second run. Nothing here guesses at progress.
//
// The friend picker filters and pages client-side, but every checkbox stays
// mounted and only its visibility toggles — so a selection made before paging
// away isn't silently dropped from the submitted form.
//
// URLs arrive as plain string props: the browser bundle is limited to
// app/browser/**, and routes.ts lives outside it. Comments in this file ship
// with the bundle, so keep vendor and catalog names out of them.
export const GenerateRecommendationsForm = clientEntry<GenerateRecommendationsFormProps>(
  import.meta.url,
  function GenerateRecommendationsForm(handle) {
    let submitting = false
    let mode: 'self' | 'group' = 'self'
    let search = ''
    let page = 1
    let playerType = ''
    let decade = ''
    // Tracked rather than left to native <details>: any re-render in this form
    // would otherwise re-close the panel, its open-ness being nowhere in the JSX.
    let filtersOpen = false
    const selectedSources = new Set<string>([handle.props.mediaType])
    const selectedFriends = new Set<number>()

    return () => {
      const {
        friends,
        viewerLoggedTypes,
        mediaType,
        mediaTypeLabel,
        sources,
        genres,
        lengthOptions,
        playerTypes,
        multiplayerTypes,
        platforms,
        seriesTypes,
        generateHref,
        findPeopleHref,
      } = handle.props
      const hasSource = selectedSources.size > 0

      const membersInRun = [
        { label: 'You', loggedTypes: viewerLoggedTypes },
        ...(mode === 'group'
          ? friends.filter((friend) => selectedFriends.has(friend.id))
          : []),
      ]
      const sourceLabel = (value: string) =>
        sources.find((source) => source.value === value)?.label ?? value
      const blockedBy = membersInRun
        .map((member) => ({
          label: member.label,
          missing: [...selectedSources].filter((source) => !member.loggedTypes.includes(source)),
        }))
        .filter((entry) => entry.missing.length > 0)

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
            <details
              open={filtersOpen}
              mix={on('toggle', (event) => {
                filtersOpen = (event.target as HTMLDetailsElement).open
                handle.update()
              })}
            >
            <summary mix={[sectionLabel, css({ cursor: 'pointer' })]}>Filters (optional)</summary>
            <div
              mix={css({
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
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
                <select
                  name="decade"
                  defaultValue=""
                  mix={on('change', (event) => {
                    decade = (event.target as HTMLSelectElement).value
                    handle.update()
                  })}
                >
                  <option value="">Any</option>
                  {DECADES.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}s
                    </option>
                  ))}
                </select>
              </Field>
              {decade !== '' && (
                <Field label="Relative to decade">
                  <select name="decade_relation" defaultValue="within">
                    <option value="before">Before</option>
                    <option value="within">Within</option>
                    <option value="after">After</option>
                  </select>
                </Field>
              )}
              <Field label="Length">
                <select name="length" defaultValue="">
                  <option value="">Any</option>
                  {lengthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {playerTypes.length > 0 && (
                <Field label="Player type">
                  <select
                    name="player_type"
                    defaultValue=""
                    mix={on('change', (event) => {
                      playerType = (event.target as HTMLSelectElement).value
                      handle.update()
                    })}
                  >
                    <option value="">Any</option>
                    {playerTypes.map((type) => (
                      <option key={type} value={type}>
                        {PLAYER_TYPE_LABELS[type] ?? type}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {playerType === 'multiplayer' && multiplayerTypes.length > 0 && (
                <Field label="Multiplayer type">
                  <select name="multiplayer_type" defaultValue="">
                    <option value="">Any</option>
                    {multiplayerTypes.map((type) => (
                      <option key={type} value={type}>
                        {MULTIPLAYER_TYPE_LABELS[type] ?? type}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {platforms.length > 0 && (
                <Field label="Platform">
                  <select name="platform" defaultValue="">
                    <option value="">Any</option>
                    {platforms.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {seriesTypes.length > 0 && (
                <Field label="Series">
                  <select name="series" defaultValue="">
                    <option value="">Any</option>
                    {seriesTypes.map((type) => (
                      <option key={type} value={type}>
                        {SERIES_TYPE_LABELS[type] ?? type}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            </details>
          </div>

          {blockedBy.length > 0 && (
            <p mix={css({ margin: '0 0 12px', fontSize: '13px', color: '#b91c1c' })}>
              {blockedBy
                .map(
                  (entry) =>
                    `${entry.label} ${entry.label === 'You' ? 'have' : 'has'} nothing logged under ` +
                    `${entry.missing.map(sourceLabel).join(' or ')}`,
                )
                .join(', and ')}
              . Everyone in the run needs something logged for each taste it reads.
            </p>
          )}

          <button type="submit" disabled={submitting || !hasSource || blockedBy.length > 0}>
            {submitting ? 'Starting…' : 'Get recommendations'}
          </button>
        </form>
      )
    }
  },
)
