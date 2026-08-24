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
  // Singular noun for one of them — "movie", "TV show", "book", "game".
  itemNoun: string
  sources: { value: string; label: string }[]
  genres: string[]
  lengthOptions: { value: string; label: string }[]
  playerTypes: string[]
  multiplayerTypes: string[]
  platforms: string[]
  seriesTypes: string[]
  // How many picks a full run comes back with, so the two buttons can say what
  // they each produce. Passed in from the pipeline's own constant.
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
  // The lucky draw posts this same form to its own action, so the group picked
  // above carries over and there is no second copy of it to keep in step.
  luckyHref: string
  // False once today's draw is spent. The button stays, greyed, so the cap is
  // visible before it is hit rather than after.
  luckyAvailable: boolean
  // How long until the next draw, already phrased ("about 7 hours"). Empty
  // while one is available.
  luckyWaitLabel: string
  // Opens the form already set to the draw, for the "today's pick" calls to
  // action elsewhere that land here instead of drawing on the spot. The server
  // only sets it when the draw is actually available, which is what keeps the
  // `isLucky` reasoning below true — the radio it selects is never a disabled
  // one.
  startLucky: boolean
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
    // Which of the two runs this form is currently set up to make. It picks the
    // action the form posts to and decides which of the fields below apply —
    // `mode` below is a different question (who the run is for), and keeps its
    // name because that one is a field the server reads.
    let runKind: 'shortlist' | 'lucky' = handle.props.startLucky ? 'lucky' : 'shortlist'
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
        itemNoun,
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
        luckyHref,
        luckyAvailable,
        luckyWaitLabel,
        startLucky,
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

      // A lucky draw reads one taste — the type being generated — and ignores
      // every lever under Settings, so it needs its own answer to "could this
      // go anywhere". Unchecking every source blocks a shortlist, not this.
      // `isLucky` already implies the draw is available — the radio for it is
      // disabled when it isn't — so only the per-kind rule is left to check.
      const isLucky = runKind === 'lucky'
      const luckyBlockedBy = membersInRun.filter((member) => !member.loggedTypes.includes(mediaType))
      const disabled =
        submitting || (isLucky ? luckyBlockedBy.length > 0 : !hasSource || blockedBy.length > 0)

      const query = search.trim().toLowerCase()
      const filtered = query ? friends.filter((friend) => friend.label.toLowerCase().includes(query)) : friends
      const totalPages = Math.max(1, Math.ceil(filtered.length / FRIENDS_PAGE_SIZE))
      if (page > totalPages) page = totalPages
      const start = (page - 1) * FRIENDS_PAGE_SIZE
      const visibleIds = new Set(filtered.slice(start, start + FRIENDS_PAGE_SIZE).map((friend) => friend.id))

      const caption = css({ margin: '10px 0 0', fontSize: '12px', color: '#888', lineHeight: 1.4 })

      // The label's default inline layout aligns the radio glyph and its text
      // on a text baseline, which sits noticeably above the glyph's own visual
      // centre — flexing the label re-centres the text on the glyph's box instead.
      //
      // That's as far as this goes without guessing: a further pixel nudge to
      // seat Short Stack's own ink exactly on the glyph's centre would need
      // measuring against the real font, and this app's dev tooling can't load
      // it (its web-font request gets reset before render), so any offset
      // tuned here would be tuned against the wrong glyph shapes entirely.
      // Check by eye against a real build before adding one.
      const radioLabel = css({ display: 'inline-flex', alignItems: 'center', gap: '8px' })

      // The one radio look used everywhere in this form — shortlist/lucky and
      // self/group all render through here, so the fix above only ever needs
      // to be right in one place.
      function radioOption(props: {
        name: string
        value: string
        checked?: boolean
        disabled?: boolean
        onChange: () => void
        children: string
      }) {
        return (
          <label mix={radioLabel}>
            <input
              type="radio"
              name={props.name}
              value={props.value}
              disabled={props.disabled}
              defaultChecked={props.checked}
              mix={on('change', props.onChange)}
            />
            {props.children}
          </label>
        )
      }

      const runsPill = css({
        display: 'inline-block',
        // Row-centring by box height isn't enough — measured directly against
        // a real screenshot (the sandbox here can't load Short Stack to check
        // it live, see radioLabel above), comparing pixel rows of ink in the
        // label text against ink in the pill: the pill sat ~9 physical px
        // above the label text, which a known-size UI element (the 20px nav
        // bell icon) puts at this device's pixel ratio around 4.5 CSS px.
        position: 'relative',
        top: '4.5px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid #ccc',
        fontSize: '11px',
        color: '#555',
      })

      // Only ever one field's worth of it on screen, so a field that does not
      // apply to the run being made is hidden rather than dropped: unmounting
      // would lose a typed name, a chosen genre and the panel's open state
      // every time someone looked at the other kind of run.
      const onlyForShortlist = css({ display: isLucky ? 'none' : 'block' })

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
          action={isLucky ? luckyHref : generateHref}
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
          {/* The first question, because it decides which of the rest apply.
              `run_kind` is not read by either action — the form posts to a
              different one for each — it is here so the two radios group. */}
          <div>
            <p mix={sectionLabel}>What are you after?</p>
            {/* Stacked like a description list — each radio is the term, the
                caption under it the description — rather than side by side,
                which read as a comparison table with two competing columns. */}
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}>
              <div>
                <div mix={css({ display: 'flex', alignItems: 'center', gap: '10px' })}>
                  {radioOption({
                    name: 'run_kind',
                    value: 'shortlist',
                    checked: !startLucky,
                    onChange: () => {
                      runKind = 'shortlist'
                      handle.update()
                    },
                    children: 'A shortlist',
                  })}
                  {/* Only ever shows once runs actually remain — the exhausted-cap
                      and no-cap cases have no count worth badging, and fall back
                      to the plain-text caption below instead. */}
                  {runsRemaining != null && runsLimit != null && (
                    <span mix={runsPill}>
                      {runsRemaining}/{runsLimit} runs left today
                    </span>
                  )}
                </div>
                <p mix={[caption, css({ paddingLeft: '1.6em' })]}>
                  {`Up to ${shortlistCount} picks, minus what most of you have already finished.`}
                  {runsRemaining == null && runsLeftLabel && ` ${runsLeftLabel}.`}
                </p>
              </div>
              <div mix={css({ color: luckyAvailable ? 'inherit' : '#888' })}>
                {radioOption({
                  name: 'run_kind',
                  value: 'lucky',
                  checked: startLucky,
                  disabled: !luckyAvailable,
                  onChange: () => {
                    runKind = 'lucky'
                    handle.update()
                  },
                  children: "Today's lucky pick",
                })}
                <p mix={[caption, css({ paddingLeft: '1.6em' })]}>
                  {`One ${itemNoun} nobody in the run has logged.`}
                </p>
                {!luckyAvailable && (
                  <p mix={[caption, css({ paddingLeft: '1.6em' })]}>
                    Already drawn — another in {luckyWaitLabel}.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div mix={onlyForShortlist}>
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

          <div
            mix={[css({ borderTop: '1px solid #eee', paddingTop: '16px' }), onlyForShortlist]}
          >
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

          {/* Whichever rule the run being made actually has to clear. Both used
              to live inside the sources block, which is folded away — and one of
              them is about a setting a lucky draw never reads. */}
          {isLucky
            ? luckyBlockedBy.length > 0 && (
                <p mix={css({ margin: 0, fontSize: '13px', color: '#b91c1c' })}>
                  {luckyBlockedBy.map((member) => member.label).join(', ')}{' '}
                  {luckyBlockedBy.length === 1 && luckyBlockedBy[0].label === 'You' ? 'have' : 'has'}{' '}
                  nothing {mediaTypeLabel} logged to draw from.
                </p>
              )
            : (!hasSource || blockedBy.length > 0) && (
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

          {/* One button, because there is one thing to press: the choice it
              makes was made at the top of the form. minHeight rather than
              padding — app.css sets the padding unlayered, where a rule from
              here cannot reach it — which also gives it a thumb-sized target. */}
          <button
            type="submit"
            disabled={disabled}
            mix={css({ minHeight: '44px', width: '100%' })}
          >
            {submitting
              ? isLucky
                ? 'Drawing…'
                : 'Starting…'
              : isLucky
                ? `🎲 Draw today's pick`
                : 'Get recommendations'}
          </button>
        </form>
      )
    }
  },
)
