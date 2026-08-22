import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { FollowingLogEntry } from '../data/mediaItems.ts'
import { parseMediaMetadata } from '../data/mediaMetadata.ts'
import type { LuckyState } from '../data/recommendations/lucky.ts'
import type { RecommendationRunSummary } from '../data/recommendations/runs.ts'
import { mediaTypeUiFor, statusLabel } from '../mediaTypes.ts'
import { routes } from '../routes.ts'
import { Document } from '../ui/components/document.tsx'
import { LuckyPickCard } from '../ui/components/lucky-pick-card.tsx'
import { Nav } from '../ui/components/nav.tsx'
import { RunList } from '../ui/components/run-list.tsx'
import { DislikedDisplay, StarRatingDisplay } from '../ui/components/star-rating.tsx'

export interface HomeDashboard {
  displayName: string
  // Today's draw, or the absence of one — see lucky.ts. `pick` being null is
  // what puts the call to action on screen.
  lucky: LuckyState
  runs: RecommendationRunSummary[]
  runsFromOthers: RecommendationRunSummary[]
  followingActivity: FollowingLogEntry[]
  // Separates "nobody you follow has logged anything" from "you follow nobody",
  // which want different things said to them.
  followsAnyone: boolean
}

export interface HomePageProps {
  // Null for a signed-out visitor, who gets the pitch rather than the dashboard.
  dashboard: HomeDashboard | null
}

// Where the side panel appears. Below it the three sections are one column in
// the order they are written: the pick, the runs, then the feed.
const WIDE = '@media (min-width: 900px)'

const CARD = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '16px',
} as const

// The label above the day's pick, matched from LuckyPickCard so the call to
// action standing in for it is the same card with different words in it.
const CARD_LABEL = {
  margin: '0 0 6px',
  fontSize: '12px',
  letterSpacing: '0.04em',
  color: '#888',
} as const

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Section(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => {
    const { title, children } = handle.props

    return (
      <section>
        <h2 mix={css({ margin: '0 0 12px', fontSize: '18px' })}>{title}</h2>
        {children}
      </section>
    )
  }
}

// The empty state every list here shares: one quiet line, and a way out of it.
function Empty(handle: Handle<{ children?: RemixNode }>) {
  return () => <p mix={css({ margin: 0, color: '#555' })}>{handle.props.children}</p>
}

// Posts the draw itself rather than linking to the form that holds the button:
// a solo draw is what the action does with an empty body, and the whole point of
// the pick is that there is nothing to fill in first.
function LuckyPickCta() {
  return () => (
    <div mix={css({ ...CARD, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' })}>
      <p mix={css(CARD_LABEL)}>Today's lucky pick</p>
      <p mix={css({ margin: 0 })}>
        <strong>Nothing drawn yet today.</strong>
      </p>
      <p mix={css({ margin: '6px 0 0', color: '#555' })}>
        One thing to watch, read or play — no filters, nothing to decide.
      </p>
      <form method="post" action={routes.recommendations.lucky.href()} mix={css({ marginTop: '12px' })}>
        <button type="submit">🎲 Draw today's pick</button>
      </form>
    </div>
  )
}

function ActivityList(handle: Handle<{ entries: FollowingLogEntry[] }>) {
  return () => {
    const { entries } = handle.props

    return (
      <ul
        mix={css({
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        })}
      >
        {entries.map(({ interaction, item, actor }) => {
          const { posterUrl } = item ? parseMediaMetadata(item.metadata) : { posterUrl: null }
          // From the row's own item, so a logged book reads "Read" and not
          // "Watched" — the same rule WatchedListItem follows.
          const detailHref = item ? mediaTypeUiFor(item.type).hrefs.show(item.id) : undefined
          const title = item?.title ?? 'Unknown title'

          return (
            <li key={interaction.id} mix={css({ ...CARD, display: 'flex', gap: '12px', padding: '12px 16px' })}>
              {posterUrl ? (
                <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
                  <img
                    src={posterUrl}
                    alt={`${title} poster`}
                    mix={css({ width: '48px', borderRadius: '4px', display: 'block' })}
                  />
                </a>
              ) : (
                <div
                  mix={css({
                    width: '48px',
                    height: '72px',
                    flex: '0 0 auto',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                  })}
                />
              )}
              <div mix={css({ minWidth: 0 })}>
                <p mix={css({ margin: 0, fontSize: '13px', color: '#555' })}>
                  <a href={routes.users.show.href({ userId: String(actor.id) })}>{actor.label}</a>{' '}
                  {statusLabel(interaction.status, item?.type).toLowerCase()}
                </p>
                {detailHref ? (
                  <a href={detailHref}>
                    <strong>{title}</strong>
                  </a>
                ) : (
                  <strong>{title}</strong>
                )}
                {interaction.rating != null && (
                  <p mix={css({ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 0' })}>
                    <StarRatingDisplay value={interaction.rating} /> ({interaction.rating})
                  </p>
                )}
                {interaction.disliked && (
                  <p mix={css({ margin: '4px 0 0' })}>
                    <DislikedDisplay />
                  </p>
                )}
                {interaction.notes && (
                  <p mix={css({ margin: '4px 0 0', fontStyle: 'italic' })}>"{interaction.notes}"</p>
                )}
                <p mix={css({ margin: '4px 0 0', fontSize: '12px', color: '#888' })}>
                  {formatDate(interaction.updated_at)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }
}

// The runs, as the column beside everything else on a wide screen. Narrow rows,
// so RunList is asked for its panel shape rather than its full-width one.
function RunPanel(
  handle: Handle<{ runs: RecommendationRunSummary[]; runsFromOthers: RecommendationRunSummary[] }>,
) {
  return () => {
    const { runs, runsFromOthers } = handle.props

    return (
      <aside
        mix={css({
          gridArea: 'runs',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          // Only on the wide layout: stacked under the pick, a rule above the
          // runs would read as a divider between two sections rather than as
          // the edge of a column. It runs the full height because the panel
          // spans both rows and is left to stretch — a rule ending where the
          // runs do would look like it had been cut short.
          [WIDE]: { borderLeft: '1px solid #ddd', paddingLeft: '24px' },
        })}
      >
        <div>
          <h2 mix={css({ margin: '0 0 12px', fontSize: '18px' })}>Your runs</h2>
          {runs.length > 0 ? (
            <RunList runs={runs} variant="panel" />
          ) : (
            <Empty>
              None yet — <a href={routes.recommendations.index.href()}>generate one</a> from what you've
              logged.
            </Empty>
          )}
        </div>

        <div>
          <h2 mix={css({ margin: '0 0 12px', fontSize: '18px' })}>Run for you</h2>
          {runsFromOthers.length > 0 ? (
            <RunList runs={runsFromOthers} variant="panel" />
          ) : (
            <Empty>
              Nothing yet — group runs someone else generated show up here once you both follow each other.
            </Empty>
          )}
        </div>
      </aside>
    )
  }
}

function Dashboard(handle: Handle<{ dashboard: HomeDashboard }>) {
  return () => {
    const { lucky, runs, runsFromOthers, followingActivity, followsAnyone } = handle.props.dashboard

    return (
      <div
        mix={css({
          display: 'grid',
          gap: '32px',
          marginTop: '32px',
          // Stated at both widths, not just the wide one. A `grid-area` naming
          // an area the template doesn't define does not fall back to automatic
          // placement — every section lands in the first cell, on top of the
          // others — so the one-column layout names its rows too.
          gridTemplateColumns: 'minmax(0, 1fr)',
          gridTemplateAreas: '"pick" "runs" "feed"',
          [WIDE]: {
            gridTemplateColumns: 'minmax(0, 1fr) 240px',
            // The runs hold the second column across both rows, so the feed
            // follows the pick straight down the first one rather than waiting
            // for the taller of the two to end.
            gridTemplateAreas: '"pick runs" "feed runs"',
            columnGap: '24px',
          },
        })}
      >
        <div mix={css({ gridArea: 'pick' })}>
          {/* No heading of its own: the card carries the label, and the call to
              action standing in for it carries the same one. */}
          {lucky.pick ? <LuckyPickCard pick={lucky.pick} returnTo={routes.home.href()} /> : <LuckyPickCta />}
        </div>

        <RunPanel runs={runs} runsFromOthers={runsFromOthers} />

        <div mix={css({ gridArea: 'feed' })}>
          <Section title="From people you follow">
            {followingActivity.length > 0 ? (
              <ActivityList entries={followingActivity} />
            ) : followsAnyone ? (
              <Empty>Quiet so far — nobody you follow has logged anything yet.</Empty>
            ) : (
              <Empty>
                You're not following anyone yet — <a href={routes.users.search.href()}>find people</a> to see
                what they're logging.
              </Empty>
            )}
          </Section>
        </div>
      </div>
    )
  }
}

function Pitch() {
  return () => (
    <>
      <h1>On Deck</h1>
      <p>
        A media taste profile for you (and your group) — movies, TV, books, and games — with a recommender
        that knows what you actually like.
      </p>
      <div
        mix={css({ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', marginTop: '32px' })}
      >
        <a
          href={routes.auth.login.index.href()}
          class="doodle-border"
          mix={css({
            display: 'inline-block',
            boxSizing: 'border-box',
            width: '420px',
            maxWidth: '100%',
            textAlign: 'center',
            textDecoration: 'none',
          })}
        >
          Log in
        </a>
        <a href={routes.auth.signup.index.href()}>Sign up</a>
      </div>
    </>
  )
}

export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    const { dashboard } = handle.props

    return (
      <Document title="On Deck">
        <Nav authed={dashboard != null} displayName={dashboard?.displayName} />
        <main
          mix={css({
            // The same 720 the nav and every other page use — the side panel
            // is carved out of that width rather than added to it, so the page
            // still lines up with the nav above it.
            maxWidth: dashboard ? '720px' : '640px',
            margin: '0 auto',
            padding: dashboard ? '32px 24px' : '48px 24px',
          })}
        >
          {dashboard ? (
            <>
              <h1 mix={css({ margin: 0 })}>Hey, {dashboard.displayName}</h1>
              <p mix={css({ margin: '8px 0 0', color: '#555' })}>
                <a href={routes.media.href()}>Search for media to log</a> or{' '}
                <a href={routes.recommendations.index.href()}>get recommendations</a>.
              </p>
              <Dashboard dashboard={dashboard} />
            </>
          ) : (
            <Pitch />
          )}
        </main>
      </Document>
    )
  }
}
