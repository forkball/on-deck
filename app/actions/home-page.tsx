import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { FollowingLogEntry } from '../data/mediaItems.ts'
import type { LuckyState } from '../data/recommendations/lucky.ts'
import type { RecommendationRunSummary } from '../data/recommendations/runs.ts'
import { mediaTypeUiFor } from '../mediaTypes.ts'
import { routes } from '../routes.ts'
import { Document } from '../ui/components/document.tsx'
import { LUCKY_CARD_BOX, LUCKY_PICK_LABEL, LuckyPickCard } from '../ui/components/lucky-pick-card.tsx'
import { Nav } from '../ui/components/nav.tsx'
import { RunList } from '../ui/components/run-list.tsx'
import { WatchedListItem } from '../ui/components/watched-list-item.tsx'

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

const HEADING = css({ margin: '0 0 12px', fontSize: '18px' })

function Section(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => {
    const { title, children } = handle.props

    return (
      <section>
        <h2 mix={HEADING}>{title}</h2>
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
    <div mix={css({ ...LUCKY_CARD_BOX, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' })}>
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
        {entries.map(({ interaction, item, actor }) => (
          <WatchedListItem
            key={interaction.id}
            interaction={interaction}
            item={item}
            detailHref={item ? mediaTypeUiFor(item.type).hrefs.show(item.id) : '#'}
            actor={actor}
          />
        ))}
      </ul>
    )
  }
}

// A sub-heading inside the merged "Activity" section — one for each of the
// three things it now shows.
const SUBHEADING = css({ margin: '20px 0 8px', fontSize: '14px' })

function Dashboard(handle: Handle<{ dashboard: HomeDashboard }>) {
  return () => {
    const { lucky, runs, runsFromOthers, followingActivity, followsAnyone } = handle.props.dashboard

    return (
      <div mix={css({ display: 'flex', flexDirection: 'column', gap: '32px', marginTop: '32px' })}>
        <Section title={LUCKY_PICK_LABEL}>
          {lucky.pick ? (
            <LuckyPickCard pick={lucky.pick} returnTo={routes.home.href()} showLabel={false} />
          ) : (
            <LuckyPickCta />
          )}
        </Section>

        <Section title="Activity">
          <h3 mix={SUBHEADING}>Your runs</h3>
          {runs.length > 0 ? (
            <RunList runs={runs} />
          ) : (
            <Empty>
              None yet — <a href={routes.recommendations.index.href()}>generate one</a> from what you've
              logged.
            </Empty>
          )}

          <h3 mix={SUBHEADING}>Run for you</h3>
          {runsFromOthers.length > 0 ? (
            <RunList runs={runsFromOthers} />
          ) : (
            <Empty>
              Nothing yet — group runs someone else generated show up here once you both follow each other.
            </Empty>
          )}

          <h3 mix={SUBHEADING}>From people you follow</h3>
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
            // The same 720 the nav uses, so the page lines up with it above.
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
