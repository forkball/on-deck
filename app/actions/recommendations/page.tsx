import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { GenerateRecommendationsForm } from '../../browser/generate-recommendations-form.tsx'
import { MediaTabLinks } from '../../ui/components/media-tab-links.tsx'
import { timeUntil, type DailyRunAllowance } from '../../data/recommendations/dailyLimit.ts'
import { TARGET_COUNT } from '../../data/recommendations/generate.ts'
import type { LuckyState } from '../../data/recommendations/lucky.ts'
import {
  MAX_LUCKY_RUNS_PER_USER,
  MAX_RUNS_PER_USER,
  type RecommendationRunSummary,
} from '../../data/recommendations/runs.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { RunList } from '../../ui/components/run-list.tsx'
import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

export interface RecommendationsPageProps {
  runs: RecommendationRunSummary[]
  // Past lucky draws — shown in their own section rather than mixed into `runs`.
  luckyRuns: RecommendationRunSummary[]
  runsFromOthers: RecommendationRunSummary[]
  friends: User[]
  // Which media types each friend has logged in, keyed by user id, and the
  // viewer's own. Both feed the form's check that a run could go anywhere.
  loggedTypes: Record<number, string[]>
  viewerLoggedTypes: string[]
  mediaType: ActiveMediaType
  genres: string[]
  lengthOptions: { value: string; label: string }[]
  playerTypes: string[]
  multiplayerTypes: string[]
  // Games only — platform families, empty for every other type.
  platforms: string[]
  seriesTypes: string[]
  displayName: string
  // How much of the daily cap is left. Nothing is rendered for admins, who
  // aren't capped — see data/recommendations/dailyLimit.ts.
  dailyRuns: DailyRunAllowance
  // Whether today's one-click draw is still available. The pick it produced is
  // not shown again up here — it is in the run list at the bottom, marked, and
  // the landing page and profile lead with it.
  lucky: LuckyState
  // Arrived from a "today's pick" call to action, so the form opens on the draw
  // rather than the shortlist. Already checked against `lucky.available` by the
  // controller — see indexPage.
  startLucky?: boolean
  error?: string
  // Set when the request matched an earlier run the user hasn't taken
  // anything from — see DuplicateNotice.
  duplicate?: {
    runId: number
    name: string | null
    createdAt: number
    // Name/value pairs that reproduce the blocked request verbatim.
    fields: [string, string][]
  }
}

const sectionCaption = css({ margin: '0 0 16px', fontSize: '13px', color: '#888' })

// A run list section that only appears once it has something to show —
// "Recommendations from others" and "Lucky picks" both work this way. Past
// recommendations doesn't reuse this: it always renders, with an empty state.
function RunsSection(handle: Handle<{ title: string; caption: string; runs: RecommendationRunSummary[] }>) {
  return () => {
    const { title, caption, runs } = handle.props
    return (
      <section mix={css({ marginTop: '40px' })}>
        <h2>{title}</h2>
        <p mix={sectionCaption}>{caption}</p>
        <RunList runs={runs} returnTo={routes.recommendations.index.href()} />
      </section>
    )
  }
}

// Shown when the same levers already produced a run whose picks are all still
// unlogged. Not a hard block — the button is right there.
function DuplicateNotice(handle: Handle<{ duplicate: NonNullable<RecommendationsPageProps['duplicate']> }>) {
  return () => {
    const { duplicate } = handle.props
    const href = routes.recommendations.show.href({ runId: String(duplicate.runId) })

    return (
      <div
        mix={css({
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
        })}
      >
        <p mix={css({ margin: '0 0 8px' })}>
          <strong>You already have a recommendation like this.</strong>
        </p>
        <p mix={css({ margin: '0 0 12px', color: '#555' })}>
          Those exact settings produced <a href={href}>{duplicate.name || 'an earlier run'}</a> on{' '}
          {new Date(duplicate.createdAt).toLocaleDateString()}, and you haven't logged anything from it yet.
          Generating again will replace it with a different set of picks.
        </p>
        <div mix={css({ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' })}>
          <a href={href}>Show me that one →</a>
          <form method="post" action={routes.recommendations.generate.href()}>
            {duplicate.fields.map(([name, value], index) => (
              <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="force" value="1" />
            <button type="submit">Generate a new one anyway</button>
          </form>
        </div>
      </div>
    )
  }
}

// Counted per person rather than per media type: a run costs the same whatever
// it is a run of. Said even when there is plenty left, so running out is never
// the first time someone hears there's a cap — and said under the button that
// spends one, which is the other half of what separates it from a lucky draw.
// Empty for an account with no cap.
function runsLeftLabel(dailyRuns: DailyRunAllowance): string {
  if (dailyRuns.unlimited) return ''

  const { remaining, limit, resetsAt } = dailyRuns
  if (remaining > 0) return `${remaining} of ${limit} runs left today`
  return resetsAt == null
    ? 'No runs left today'
    : `No runs left today — the next in about ${timeUntil(resetsAt)}`
}

export function RecommendationsPage(handle: Handle<RecommendationsPageProps>) {
  return () => {
    const {
      runs,
      luckyRuns,
      runsFromOthers,
      friends,
      loggedTypes,
      viewerLoggedTypes,
      mediaType,
      genres,
      lengthOptions,
      playerTypes,
      multiplayerTypes,
      platforms,
      seriesTypes,
      displayName,
      dailyRuns,
      lucky,
      startLucky,
      error,
      duplicate,
    } = handle.props
    const recsHref = routes.recommendations.index.href()
    const ui = MEDIA_TYPE_UI[mediaType]

    return (
      <Document title="Recommendations | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Recommendations</h1>
          <p mix={css({ margin: 0, color: '#555' })}>
            Rewrites your {ui.attributive} taste profile from what you've logged, then finds picks to try
            next.
          </p>
          <p mix={css({ margin: '4px 0 0', color: '#888', fontSize: '13px' })}>
            Only your last {MAX_RUNS_PER_USER} runs are kept — generating a new one deletes the oldest.
          </p>
          <MediaTabLinks current={mediaType} hrefFor={(type) => `${recsHref}?mediaType=${type}`} />

          {duplicate && <DuplicateNotice duplicate={duplicate} />}

          {error && (
            <p
              mix={css({
                margin: '0 0 16px',
                padding: '12px 16px',
                border: '1px solid #b91c1c',
                borderRadius: '8px',
                color: '#b91c1c',
              })}
            >
              {error}
            </p>
          )}

          <GenerateRecommendationsForm
            friends={friends.map((friend) => ({
              id: friend.id,
              label: displayLabel(friend),
              loggedTypes: loggedTypes[friend.id] ?? [],
            }))}
            viewerLoggedTypes={viewerLoggedTypes}
            mediaType={mediaType}
            mediaTypeLabel={ui.attributive}
            itemNoun={ui.singular}
            shortlistCount={TARGET_COUNT}
            runsLeftLabel={runsLeftLabel(dailyRuns)}
            runsRemaining={!dailyRuns.unlimited && dailyRuns.remaining > 0 ? dailyRuns.remaining : undefined}
            runsLimit={!dailyRuns.unlimited && dailyRuns.remaining > 0 ? dailyRuns.limit : undefined}
            sources={ACTIVE_MEDIA_TYPES.map((type) => ({
              value: type,
              label: `${MEDIA_TYPE_UI[type].attributive} taste`,
            }))}
            genres={genres}
            lengthOptions={lengthOptions}
            playerTypes={playerTypes}
            multiplayerTypes={multiplayerTypes}
            platforms={platforms}
            seriesTypes={seriesTypes}
            generateHref={routes.recommendations.generate.href()}
            luckyHref={routes.recommendations.lucky.href()}
            luckyAvailable={lucky.available}
            luckyWaitLabel={lucky.nextAt == null ? '' : `about ${timeUntil(lucky.nextAt)}`}
            startLucky={startLucky === true}
            findPeopleHref={routes.users.search.href()}
          />

          {runsFromOthers.length > 0 && (
            <RunsSection
              title="Recommendations from others"
              caption="Group runs that included you."
              runs={runsFromOthers}
            />
          )}

          {luckyRuns.length > 0 && (
            <RunsSection
              title="Lucky picks"
              caption={`Your last ${MAX_LUCKY_RUNS_PER_USER} draws.`}
              runs={luckyRuns}
            />
          )}

          <section mix={css({ marginTop: '40px' })}>
            <h2>Past recommendations</h2>
            {runs.length > 0 && (
              <p mix={sectionCaption}>
                Your last {MAX_RUNS_PER_USER} {ui.attributive} runs.
              </p>
            )}
            {runs.length === 0 ? (
              <p>
                Nothing yet — log a few {ui.plural} on your{' '}
                <a href={routes.profile.index.href()}>profile page</a>, then get recommendations above.
              </p>
            ) : (
              <RunList runs={runs} returnTo={routes.recommendations.index.href()} />
            )}
          </section>
        </main>
      </Document>
    )
  }
}
