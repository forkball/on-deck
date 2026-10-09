import { clientEntry, css, on } from 'remix/ui'

import { Field } from '../ui/shared/field.tsx'
import { SEEN_BY_OPTIONS, type SeenBy } from '../ui/shared/seen-by.ts'
import { FriendPicker, type FriendOption } from './friend-picker.tsx'
import {
  Button,
  CheckboxOption,
  ChoiceGroup,
  RadioOption,
  Select,
  TextInput,
} from '../ui/shared/form-controls.tsx'

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

// The Settings disclosure's label, in the same small capitals as the
// ChoiceGroup legends above it (`.choice-legend.section` in app.css). Kept as a
// css() rule because a <summary> can't take the legend's display: block without
// losing its disclosure triangle.
const sectionLabel = css({
  margin: '0 0 10px',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
})

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

const PLAYER_TYPE_LABELS: Record<string, string> = {
  singleplayer: 'Singleplayer',
  multiplayer: 'Multiplayer',
}
const MULTIPLAYER_TYPE_LABELS: Record<string, string> = { coop: 'Co-op', versus: 'Versus' }
const SERIES_TYPE_LABELS: Record<string, string> = { series: 'Part of a series', standalone: 'Standalone' }

const PLACEHOLDER_SOURCES: string[] = []

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
    let seenBy: SeenBy = 'no_one'
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
      // Who is actually in it, not which radio is set. "With friends" with nobody
      // ticked isn't a group run yet, and can't be submitted.
      const isGroupRun = membersInRun.length > 1
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
      // Either kind of run: both read the same picker. The button just stays
      // disabled — nothing ticked is a step not taken yet, not a mistake.
      const noFriendsPicked = mode === 'group' && !isGroupRun
      const disabled =
        submitting ||
        noFriendsPicked ||
        (isLucky ? luckyBlockedBy.length > 0 : !hasSource || blockedBy.length > 0)

      const runsPill = css({
        display: 'inline-block',
        // Inside the option's label, so this is its distance from the words.
        marginLeft: '10px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid var(--rule)',
        fontSize: '11px',
        color: 'var(--soft)',
      })

      // Settings falls into sections — what taste picks are drawn from, what
      // narrows them, and what only a group has — each under a heading that
      // reads as part of the panel rather than a second caps section label.
      const settingsSection = css({ display: 'flex', flexDirection: 'column', gap: '8px' })
      const sectionDivider = css({
        marginTop: '16px',
        paddingTop: '16px',
        borderTop: '1px dashed var(--rule-soft)',
      })
      const settingsHeading = css({ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text)' })
      // auto-fill rather than auto-fit, so a section with one field keeps the
      // same column width as one with five instead of stretching it across.
      const settingsGrid = css({
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '12px',
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
              border: '1px solid var(--rule)',
              borderRadius: '8px',
              padding: '20px',
            }),
            on('submit', () => {
              submitting = true
              handle.update()
            }),
          ]}
        >
          <ChoiceGroup legend="What are you after?">
            <RadioOption
              name="run_kind"
              value="shortlist"
              defaultChecked={!startLucky}
              mix={on('change', () => {
                runKind = 'shortlist'
                handle.update()
              })}
              hint={
                <>
                  {shortlistCaption(shortlistCount, seenBy, isGroupRun)}
                  {runsRemaining == null && runsLeftLabel && ` ${runsLeftLabel}.`}
                </>
              }
            >
              A shortlist
              {runsRemaining != null && runsLimit != null && (
                <span mix={runsPill}>
                  {runsRemaining}/{runsLimit} runs left today
                </span>
              )}
            </RadioOption>
            <RadioOption
              name="run_kind"
              value="lucky"
              defaultChecked={startLucky}
              disabled={!luckyAvailable}
              mix={on('change', () => {
                runKind = 'lucky'
                handle.update()
              })}
              hint={
                <>
                  {`One ${itemNoun} nobody in the run has logged.`}
                  {!luckyAvailable && <div>Already drawn — another in {luckyWaitLabel}.</div>}
                </>
              }
            >
              Today's lucky pick
            </RadioOption>
          </ChoiceGroup>

          <div mix={onlyForShortlist}>
            <Field label="Name this run (optional)">
              <TextInput name="name" placeholder="e.g. Cozy weekend picks" />
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

          <input type="hidden" name="mediaType" value={mediaType} />

          <div mix={[css({ borderTop: '1px solid var(--rule-soft)', paddingTop: '16px' }), onlyForShortlist]}>
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
              <summary class="tap-area" mix={[sectionLabel, css({ cursor: 'pointer' })]}>
                Settings (optional)
                {!settingsOpen && hasSource && !sourcesAreDefault && (
                  <span mix={css({ textTransform: 'none', letterSpacing: 0, fontWeight: 400 })}>
                    {' '}
                    — based on {[...selectedSources].map(sourceLabel).join(', ')}
                  </span>
                )}
              </summary>

              <ChoiceGroup
                legend="Taste"
                legendSize="subsection"
                layout="row"
                mix={css({ marginTop: '12px' })}
                hint={
                  hasSource &&
                  `You'll still get ${mediaTypeLabel} picks — this only changes which taste they're drawn from.`
                }
              >
                {sources.map((source) => (
                  <CheckboxOption
                    key={source.value}
                    name="source"
                    value={source.value}
                    checked={selectedSources.has(source.value)}
                    mix={on('change', (event) => {
                      if ((event.target as HTMLInputElement).checked) selectedSources.add(source.value)
                      else selectedSources.delete(source.value)
                      handle.update()
                    })}
                  >
                    {source.label}
                  </CheckboxOption>
                ))}
                {PLACEHOLDER_SOURCES.map((label) => (
                  <CheckboxOption key={label} disabled>
                    {label} <span mix={css({ fontStyle: 'italic', fontSize: '12px' })}>(soon)</span>
                  </CheckboxOption>
                ))}
              </ChoiceGroup>

              <section mix={[settingsSection, sectionDivider]}>
                <p mix={settingsHeading}>Filters</p>
                <div mix={settingsGrid}>
                  <Field label="Genre">
                    <Select name="genre" defaultValue="">
                      <option value="">Any</option>
                      {genres.map((genre) => (
                        <option value={genre}>{genre.replace(/^./, (c) => c.toUpperCase())}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Decade">
                    <Select
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
                    </Select>
                  </Field>
                  {decade !== '' && (
                    <Field label="Relative to decade">
                      <Select name="decade_relation" defaultValue="within">
                        <option value="before">Before</option>
                        <option value="within">Within</option>
                        <option value="after">After</option>
                      </Select>
                    </Field>
                  )}
                  <Field label="Length">
                    <Select name="length" defaultValue="">
                      <option value="">Any</option>
                      {lengthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {playerTypes.length > 0 && (
                    <Field label="Player type">
                      <Select
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
                      </Select>
                    </Field>
                  )}
                  {playerType === 'multiplayer' && multiplayerTypes.length > 0 && (
                    <Field label="Multiplayer type">
                      <Select name="multiplayer_type" defaultValue="">
                        <option value="">Any</option>
                        {multiplayerTypes.map((type) => (
                          <option key={type} value={type}>
                            {MULTIPLAYER_TYPE_LABELS[type] ?? type}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {platforms.length > 0 && (
                    <Field label="Platform">
                      <Select name="platform" defaultValue="">
                        <option value="">Any</option>
                        {platforms.map((platform) => (
                          <option key={platform} value={platform}>
                            {platform}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {seriesTypes.length > 0 && (
                    <Field label="Series">
                      <Select name="series" defaultValue="">
                        <option value="">Any</option>
                        {seriesTypes.map((type) => (
                          <option key={type} value={type}>
                            {SERIES_TYPE_LABELS[type] ?? type}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              </section>

              {/* Hidden rather than unmounted, like the friend list, so a
                  choice survives a trip to "Just me" and back, or unticking
                  everyone. */}
              <section
                mix={[settingsSection, sectionDivider, css({ display: isGroupRun ? 'block' : 'none' })]}
              >
                <p mix={settingsHeading}>Group</p>
                <div mix={settingsGrid}>
                  <Field label="History">
                    <Select
                      name="seen_by"
                      defaultValue="no_one"
                      mix={on('change', (event) => {
                        seenBy = (event.target as HTMLSelectElement).value as SeenBy
                        handle.update()
                      })}
                    >
                      {SEEN_BY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </section>
            </details>
          </div>

          {isLucky
            ? luckyBlockedBy.length > 0 && (
                <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--danger)' })}>
                  {luckyBlockedBy.map((member) => member.label).join(', ')}{' '}
                  {luckyBlockedBy.length === 1 && luckyBlockedBy[0].label === 'You' ? 'have' : 'has'} nothing{' '}
                  {mediaTypeLabel} logged to draw from.
                </p>
              )
            : (!hasSource || blockedBy.length > 0) && (
                <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--danger)' })}>
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

          <Button type="submit" variant="primary" disabled={disabled} mix={css({ width: '100%' })}>
            {submitting
              ? isLucky
                ? 'Drawing…'
                : 'Starting…'
              : isLucky
                ? `🎲 Draw today's pick`
                : 'Get recommendations'}
          </Button>
        </form>
      )
    }
  },
)
