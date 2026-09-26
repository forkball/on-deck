import { clientEntry, css, on } from 'remix/ui'

import { Field } from '../ui/shared/field.tsx'
import { FriendPicker, radioOption, sectionLabel, type FriendOption } from './friend-picker.tsx'

export type { FriendOption }

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
  // How many picks a full run comes back with.
  shortlistCount: number
  // "3 of 5 runs left today", already phrased — the fallback once the cap is
  // spent (or for an account with no cap, where it's empty). While runs
  // remain, runsRemaining/runsLimit take over so the count renders as a pill.
  runsLeftLabel: string
  runsRemaining?: number
  runsLimit?: number
  generateHref: string
  luckyHref: string
  // False once today's draw is spent. The button stays, greyed, so the cap is
  // visible before it is hit rather than after.
  luckyAvailable: boolean
  luckyWaitLabel: string
  // Opens the form already set to the draw, for calls to action elsewhere
  // that land here instead of drawing on the spot.
  startLucky: boolean
  findPeopleHref: string
}

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

const PLAYER_TYPE_LABELS: Record<string, string> = {
  singleplayer: 'Singleplayer',
  multiplayer: 'Multiplayer',
}
const MULTIPLAYER_TYPE_LABELS: Record<string, string> = { coop: 'Co-op', versus: 'Versus' }
const SERIES_TYPE_LABELS: Record<string, string> = { series: 'Part of a series', standalone: 'Standalone' }

const PLACEHOLDER_SOURCES: string[] = []

// Values match SeenByExpectation in data/recommendations/picks.ts, which this
// module can't import. 'half' is first-checked because it is what a group run
// did before there was a choice.
const SEEN_BY_OPTIONS = [
  { value: 'no_one', label: 'No one has logged it' },
  { value: 'half', label: "At least half haven't logged it" },
  { value: 'any', label: "Doesn't matter" },
] as const
type SeenBy = (typeof SEEN_BY_OPTIONS)[number]['value']

// The shortlist's caption, which otherwise promises a rule the group just
// changed. Alone, the default reads the same: one person is "most of you".
function shortlistCaption(count: number, seenBy: SeenBy, isGroup: boolean): string {
  if (!isGroup) return `Up to ${count} picks, minus what you've already finished.`
  if (seenBy === 'no_one') return `Up to ${count} picks, minus anything any of you has finished.`
  if (seenBy === 'any') return `Up to ${count} picks, whether or not you've seen them.`
  return `Up to ${count} picks, minus what most of you have already finished.`
}

// Submitting redirects almost immediately to a page reporting the real stage,
// so this only covers that hop: the button disables itself so a second
// submit can't start a second run.
export const GenerateRecommendationsForm = clientEntry<GenerateRecommendationsFormProps>(
  import.meta.url,
  function GenerateRecommendationsForm(handle) {
    let submitting = false
    let runKind: 'shortlist' | 'lucky' = handle.props.startLucky ? 'lucky' : 'shortlist'
    let mode: 'self' | 'group' = 'self'
    let seenBy: SeenBy = 'half'
    let search = ''
    let page = 1
    const selectedFriends = new Set<number>()
    let playerType = ''
    let decade = ''
    // Tracked rather than left to native <details>: any re-render would
    // otherwise re-close the panel, its open-ness being nowhere in the JSX.
    let settingsOpen = false
    const selectedSources = new Set<string>([handle.props.mediaType])

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
        ...(mode === 'group' ? friends.filter((friend) => selectedFriends.has(friend.id)) : []),
      ]
      const sourceLabel = (value: string) => sources.find((source) => source.value === value)?.label ?? value
      const blockedBy = membersInRun
        .map((member) => ({
          label: member.label,
          missing: [...selectedSources].filter((source) => !member.loggedTypes.includes(source)),
        }))
        .filter((entry) => entry.missing.length > 0)

      // A lucky draw reads one taste — the type being generated — and ignores
      // every lever under Settings, so it needs its own answer to "could this
      // go anywhere".
      const isLucky = runKind === 'lucky'
      const luckyBlockedBy = membersInRun.filter((member) => !member.loggedTypes.includes(mediaType))
      const disabled =
        submitting || (isLucky ? luckyBlockedBy.length > 0 : !hasSource || blockedBy.length > 0)

      const caption = css({ margin: '10px 0 0', fontSize: '12px', color: '#888', lineHeight: 1.4 })

      const runsPill = css({
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid #ccc',
        fontSize: '11px',
        color: '#555',
      })

      // A field that doesn't apply to the run being made is hidden rather
      // than dropped, so switching kinds doesn't lose what was typed.
      const onlyForShortlist = css({ display: isLucky ? 'none' : 'block' })

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
          <div>
            <p mix={sectionLabel}>What are you after?</p>
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
                  {runsRemaining != null && runsLimit != null && (
                    <span mix={runsPill}>
                      {runsRemaining}/{runsLimit} runs left today
                    </span>
                  )}
                </div>
                <p mix={[caption, css({ paddingLeft: '1.6em' })]}>
                  {shortlistCaption(shortlistCount, seenBy, mode === 'group')}
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
                <p
                  mix={[caption, css({ paddingLeft: '1.6em' })]}
                >{`One ${itemNoun} nobody in the run has logged.`}</p>
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

          {/* Hidden rather than unmounted, like the fields above, so a choice
              survives a trip to "Just me" and back. The server ignores it on a
              run with nobody else in it. */}
          <div mix={css({ display: !isLucky && mode === 'group' ? 'block' : 'none' })}>
            <p mix={sectionLabel}>Already logged</p>
            <div mix={css({ display: 'flex', gap: '20px', flexWrap: 'wrap' })}>
              {SEEN_BY_OPTIONS.map((option) =>
                radioOption({
                  name: 'seen_by',
                  value: option.value,
                  checked: option.value === 'half',
                  onChange: () => {
                    seenBy = option.value
                    handle.update()
                  },
                  children: option.label,
                }),
              )}
            </div>
            <p mix={caption}>
              Only finished ones count — want-to and in-progress don't rule anything out. Anything someone
              marked not interested is always left out.
            </p>
          </div>

          <input type="hidden" name="mediaType" value={mediaType} />

          <div mix={[css({ borderTop: '1px solid #eee', paddingTop: '16px' }), onlyForShortlist]}>
            <details
              open={settingsOpen}
              mix={on('toggle', (event) => {
                settingsOpen = (event.target as HTMLDetailsElement).open
                handle.update()
              })}
            >
              {/* Named on the summary when closed and not what the page
                  implies — folded away with no sign of it, a run drawn from a
                  different taste would look like a bug. */}
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
                    You'll still get {mediaTypeLabel} picks — this only changes which taste they're drawn
                    from.
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

          {isLucky
            ? luckyBlockedBy.length > 0 && (
                <p mix={css({ margin: 0, fontSize: '13px', color: '#b91c1c' })}>
                  {luckyBlockedBy.map((member) => member.label).join(', ')}{' '}
                  {luckyBlockedBy.length === 1 && luckyBlockedBy[0].label === 'You' ? 'have' : 'has'} nothing{' '}
                  {mediaTypeLabel} logged to draw from.
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

          <button type="submit" disabled={disabled} mix={css({ minHeight: '44px', width: '100%' })}>
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
