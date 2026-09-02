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
  // How many picks a full run comes back with, so the caption can say what it
  // produces. Passed in from the pipeline's own constant.
  shortlistCount: number
  // "3 of 5 runs left today", already phrased — the fallback once the cap is
  // spent (or for an account with no cap, where it's empty). While runs remain,
  // runsRemaining/runsLimit take over so the count can render as a pill instead.
  runsLeftLabel: string
  // Set together, and only while there's a cap and runs remain — the same
  // condition under which the plain-text runsLeftLabel above steps back.
  runsRemaining?: number
  runsLimit?: number
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
    let settingsOpen = false
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
        shortlistCount,
        runsLeftLabel,
        runsRemaining,
        runsLimit,
        generateHref,
        findPeopleHref,
      } = handle.props
      const hasSource = selectedSources.size > 0
      const sourcesAreDefault = selectedSources.size === 1 && selectedSources.has(mediaType)

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

      const disabled = submitting || !hasSource || blockedBy.length > 0

      const query = search.trim().toLowerCase()
      const filtered = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends
      const totalPages = Math.max(1, Math.ceil(filtered.length / FRIENDS_PAGE_SIZE))
      if (page > totalPages) page = totalPages
      const start = (page - 1) * FRIENDS_PAGE_SIZE
      const visibleIds = new Set(filtered.slice(start, start + FRIENDS_PAGE_SIZE).map((friend) => friend.id))

      const caption = css({ margin: '10px 0 0', fontSize: '12px', color: '#888', lineHeight: 1.4 })

      // Flex does the aligning, but it has to live on a span rather than the
      // label: DoodleCSS sets `.doodle label { display: inline-block }`
      // unlayered, which beats a layered css() rule at any specificity, so a
      // flex label is silently dropped (same trap app.css documents for
      // label padding). Inside the wrapper, centring puts the radio's ring on
      // the row's centre line — the hand-drawn ring is a border-image painted
      // across the whole input box, so its box centre is its visual centre.
      //
      // line-height: 1 keeps the text's own box from out-growing the 32px
      // input and pulling the centre off it.
      const radioRow = css({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        lineHeight: 1,
      })

      // The browser's own default for a radio is `margin: 3px 3px 0 5px` —
      // top and bottom differ, so centring the margin box leaves the control
      // itself sitting 1.5px low. Zeroing it lets the ring land where flex
      // actually put it.
      const radioInput = css({ margin: 0 })

      // The one thing flex can't reach. Letters don't sit centred in their own
      // line box: the space above the capitals and below the baseline differ,
      // by an amount baked into the font's metrics that no CSS keyword
      // exposes. Measured off a real render of Short Stack and kept in em so
      // it survives a change of type scale.
      const radioLabelText = css({ position: 'relative', top: '0.05em' })

      // The one radio look used everywhere in this form — self/group renders
      // through here, so the fix above only ever needs to be right in one place.
      function radioOption(props: {
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

      const runsPill = css({
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid #ccc',
        fontSize: '11px',
        color: '#555',
      })

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
          <div>
            {/* Centre, not baseline: the pill is a shape, not a run of text, so
                what should line up with the words is the middle of that shape —
                baseline would hang it off its own text instead, which sits low
                inside its padding. */}
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '10px' })}>
              <p mix={sectionLabel}>A shortlist</p>
              {/* Only ever shows once runs actually remain — the exhausted-cap
                  and no-cap cases have no count worth badging, and fall back
                  to the plain-text caption below instead. */}
              {runsRemaining != null && runsLimit != null && (
                <span mix={runsPill}>
                  {runsRemaining}/{runsLimit} runs left today
                </span>
              )}
            </div>
            <p mix={caption}>
              {`Up to ${shortlistCount} picks, minus what most of you have already finished.`}
              {runsRemaining == null && runsLeftLabel && ` ${runsLeftLabel}.`}
            </p>
          </div>

          <div>
            <Field label="Name this run (optional)">
              <input type="text" name="name" placeholder="e.g. Cozy weekend picks" />
            </Field>
          </div>

          <div>
            <p mix={sectionLabel}>Who's this for?</p>
            <div mix={css({ display: 'flex', gap: '20px' })}>
              {radioOption({
                name: 'mode',
                value: 'self',
                checked: true,
                onChange: () => {
                  mode = 'self'
                  handle.update()
                },
                children: 'Just me',
              })}
              {radioOption({
                name: 'mode',
                value: 'group',
                disabled: friends.length === 0,
                onChange: () => {
                  mode = 'group'
                  handle.update()
                },
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
            <details
              open={settingsOpen}
              mix={on('toggle', (event) => {
                settingsOpen = (event.target as HTMLDetailsElement).open
                handle.update()
              })}
            >
            {/* Named on the summary when it is closed and not what the page
                implies. Which taste a run reads changes the picks as much as
                any filter does, and folded away with no sign of it, a run drawn
                from something else would look like a bug. */}
            <summary mix={[sectionLabel, css({ cursor: 'pointer' })]}>
              Settings (optional)
              {!settingsOpen && hasSource && !sourcesAreDefault && (
                <span mix={css({ textTransform: 'none', letterSpacing: 0, fontWeight: 400 })}>
                  {' '}
                  — based on {[...selectedSources].map(sourceLabel).join(', ')}
                </span>
              )}
            </summary>

            <div mix={css({ marginTop: '12px', marginBottom: '16px' })}>
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
              {hasSource && (
                <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#888' })}>
                  You'll still get {mediaTypeLabel} picks — this only changes which taste they're
                  drawn from.
                </p>
              )}
            </div>

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

          {(!hasSource || blockedBy.length > 0) && (
            <p mix={css({ margin: 0, fontSize: '13px', color: '#b91c1c' })}>
              {!hasSource
                ? 'Pick at least one taste to base picks on, under Settings.'
                : blockedBy
                    .map(
                      (entry) =>
                        `${entry.label} ${entry.label === 'You' ? 'have' : 'has'} nothing logged under ` +
                        `${entry.missing.map(sourceLabel).join(' or ')}`,
                    )
                    .join(', and ') +
                  '. Everyone in the run needs something logged for each taste it reads.'}
            </p>
          )}

          {/* One button, because there is one thing to press. minHeight rather
              than padding — app.css sets the padding unlayered, where a rule
              from here cannot reach it — which also gives it a thumb-sized
              target. */}
          <button
            type="submit"
            disabled={disabled}
            mix={css({ minHeight: '44px', width: '100%' })}
          >
            {submitting ? 'Starting…' : 'Get recommendations'}
          </button>
        </form>
      )
    }
  },
)
