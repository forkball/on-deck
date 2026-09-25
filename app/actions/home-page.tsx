import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { FeedAutoLoad } from '../browser/feed-auto-load.tsx'
import type { FeedCursor, FeedItem } from '../data/feed.ts'
import type { LuckyState } from '../data/recommendations/lucky.ts'
import { luckyRecommendationsHref, routes } from '../routes.ts'
import { Document } from '../ui/components/document.tsx'
import { LUCKY_CARD_BOX, LUCKY_PICK_LABEL, LuckyPickCard } from '../ui/components/lucky-pick-card.tsx'
import { Nav } from '../ui/components/nav.tsx'
import { FEED_LIST_ID, FeedList } from './activity-feed.tsx'

export interface HomeDashboard {
  displayName: string
  // Today's draw, or the absence of one — see lucky.ts. `pick` being null is
  // what puts the call to action on screen.
  lucky: LuckyState
  // Recommendation runs and what people you follow have logged, already merged
  // into one list newest-first — see data/feed.ts. The page renders the first
  // page and FeedAutoLoad fetches the rest.
  feed: FeedItem[]
  feedCursor: FeedCursor | null
  // Only consulted when the feed is empty, to separate "nothing has happened
  // yet" from "there is nobody and nothing for anything to happen from", which
  // want different things said to them.
  followsAnyone: boolean
}

export interface HomePageProps {
  // Null for a signed-out visitor, who gets the pitch rather than the dashboard.
  dashboard: HomeDashboard | null
}

const HEADING = css({ margin: '0 0 12px', fontSize: '18px' })

// The page's two ways in, styled as buttons the way the lucky-pick and sign-in
// links are: DoodleCSS's border does the drawing. Each grows to fill its row,
// so side by side they split the width and stacked on a phone they match.
const CTA_BUTTON = css({
  flex: '1 1 auto',
  textAlign: 'center',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
})

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

// Opens the dedicated lucky-pick page rather than drawing on the spot — a
// click here can't say who the pick is for, and that page still can.
// Styled as a button the way the sign-in link is.
function LuckyPickCta() {
  return () => (
    <div mix={css({ ...LUCKY_CARD_BOX, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' })}>
      <p mix={css({ margin: 0 })}>
        <strong>Nothing drawn yet today.</strong>
      </p>
      <p mix={css({ margin: '6px 0 0', color: '#555' })}>
        One thing to watch, read or play — no filters, nothing to decide.
      </p>
      {/* rmx-document forces a full document load — see media-tab-links.tsx. */}
      <a
        href={luckyRecommendationsHref()}
        rmx-document=""
        class="doodle-border"
        mix={css({ display: 'inline-block', marginTop: '12px', textDecoration: 'none' })}
      >
        🎲 Draw today's pick
      </a>
    </div>
  )
}

// Sits under the feed: the auto-loader's "Loading…" line, and the line that
// says there is nothing older.
//
// The end text is written here when the first page is already the last one —
// which is also what a reader with JS off sees, the feed reading as finished
// rather than as cut short — and handed to the auto-loader for when it is the
// one that reaches the end. One string either way.
const FEED_STATUS_ID = 'home-activity-status'
const FEED_END_TEXT = 'Nothing older.'

function Dashboard(handle: Handle<{ dashboard: HomeDashboard }>) {
  return () => {
    const { lucky, feed, feedCursor, followsAnyone } = handle.props.dashboard

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
          {feed.length > 0 ? (
            <>
              <FeedList items={feed} />
              <p
                id={FEED_STATUS_ID}
                mix={css({ margin: '12px 0 0', fontSize: '12px', color: '#888', textAlign: 'center' })}
              >
                {feedCursor ? '' : FEED_END_TEXT}
              </p>
              {feedCursor && (
                <FeedAutoLoad
                  feedHref={routes.feed.href()}
                  listId={FEED_LIST_ID}
                  cursor={JSON.stringify(feedCursor)}
                  statusId={FEED_STATUS_ID}
                  endText={FEED_END_TEXT}
                />
              )}
            </>
          ) : followsAnyone ? (
            <Empty>Quiet so far — nothing logged yet.</Empty>
          ) : (
            <Empty>
              Nothing here yet — <a href={routes.users.search.href()}>find people</a> to follow.
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
        mix={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          alignItems: 'center',
          marginTop: '32px',
        })}
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
              <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '16px' })}>
                <a href={routes.media.href()} class="doodle-border" mix={CTA_BUTTON}>
                  Search for media to log
                </a>
                <a href={routes.recommendations.index.href()} class="doodle-border" mix={CTA_BUTTON}>
                  Get recommendations
                </a>
              </div>
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
