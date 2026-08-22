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

// Where the side panel appears, and the two halves of that line. Both halves
// are needed because the collapse below is mobile-only: stating it as "not
// WIDE" is what keeps the wide layout from ever reading a collapsed state.
const PANEL_BREAKPOINT = 900
const WIDE = `@media (min-width: ${PANEL_BREAKPOINT}px)`
const NARROW = `@media (max-width: ${PANEL_BREAKPOINT - 0.02}px)`

// The folding heading and the plain one are the same <h2> with the same style,
// which is what lines the pick column up with the panel beside it: a heading
// that measured differently in one of them would take the card borders out of
// line with it.
const HEADING = css({ margin: '0 0 12px', fontSize: '18px' })

// A checkbox rather than <details>, because the fold only exists below the
// breakpoint: every rule that reads the box sits inside NARROW, so the wide
// layout renders the body whatever state the box is in. <details> keeps its
// openness in the element, so a section folded on a phone and carried into the
// wide layout would stay folded there, with no control left to reopen it.
//
// That is a support window rather than a limit — `::details-content` can
// force a closed <details> open at wide width — but it is Baseline newly
// available, where the sibling selectors below are not. Worth revisiting.
//
// One constant rather than a function of the section's id: `input:checked ~`
// reaches the same elements `:has(#id:checked)` did, without an id to
// interpolate. The id still binds the <label> to the box, just not the CSS.
//
// Base rule then the checked override, both in one object: two css() calls
// land in two @layers ordered by declaration, so a later base would beat an
// earlier override. Same reason media-tabs.tsx builds its style this way.
const COLLAPSIBLE = css({
  // Off-screen rather than `display: none`, which would take it out of the
  // focus order and leave the heading unreachable by keyboard.
  '& > input[type="checkbox"]': {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
  [NARROW]: {
    '& label': { cursor: 'pointer' },
    // `disclosure-closed` / `disclosure-open` are the list-style values a
    // <summary> uses for its own marker, so this fold reads as the same control
    // as the profile's taste-profile disclosure rather than as a second thing
    // that also opens.
    //
    // All of it on the <span> rather than the <label>: DoodleCSS's unlayered
    // `.doodle label` rule outranks anything a css() call can say about a
    // <label>, but it has nothing to say about a bare <span>. The padding makes
    // a thumb-sized band across the row rather than a tap target the width of
    // the words, and `list-item` on the same element keeps the marker on the
    // text's line instead of a line of its own.
    '& label > span': {
      display: 'list-item',
      listStyleType: 'disclosure-closed',
      listStylePosition: 'inside',
      padding: '0.55em 0',
    },
    '& > .collapsible-body': { display: 'none' },
    '& > input:checked ~ h2 label > span': { listStyleType: 'disclosure-open' },
    '& > input:checked ~ .collapsible-body': { display: 'block' },
  },
  // Above the breakpoint the section can't be folded, so its heading is a
  // heading: not a control that silently toggles a checkbox nothing reads.
  // Stated here rather than in app.css because DoodleCSS says nothing about
  // pointer-events, so this is a rule a css() call can win.
  [WIDE]: { '& label': { pointerEvents: 'none' } },
})

function Section(
  handle: Handle<{
    title: string
    // Set to make the section fold away under the panel breakpoint. Binds the
    // heading to its checkbox, so it has to be unique on the page.
    collapseId?: string
    children?: RemixNode
  }>,
) {
  return () => {
    const { title, collapseId, children } = handle.props

    return (
      <section mix={collapseId ? COLLAPSIBLE : undefined}>
        {collapseId && <input type="checkbox" id={collapseId} defaultChecked />}
        <h2 mix={HEADING}>
          {collapseId ? (
            /* See app.css — the class is what keeps this heading the same
               height as a plain one. */
            <label for={collapseId} class="section-toggle">
              <span>{title}</span>
            </label>
          ) : (
            title
          )}
        </h2>
        {collapseId ? <div class="collapsible-body">{children}</div> : children}
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
        <Section title="Your runs" collapseId="home-your-runs">
          {runs.length > 0 ? (
            <RunList runs={runs} variant="panel" />
          ) : (
            <Empty>
              None yet — <a href={routes.recommendations.index.href()}>generate one</a> from what you've
              logged.
            </Empty>
          )}
        </Section>

        <Section title="Run for you" collapseId="home-runs-for-you">
          {runsFromOthers.length > 0 ? (
            <RunList runs={runsFromOthers} variant="panel" />
          ) : (
            <Empty>
              Nothing yet — group runs someone else generated show up here once you both follow each other.
            </Empty>
          )}
        </Section>
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
          {/* Headed here rather than inside the card, so this column opens the
              same way the one beside it does — a heading, then a border. That
              is what puts the two columns' first card on the same line. */}
          <Section title={LUCKY_PICK_LABEL}>
            {lucky.pick ? (
              <LuckyPickCard pick={lucky.pick} returnTo={routes.home.href()} showLabel={false} />
            ) : (
              <LuckyPickCta />
            )}
          </Section>
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
            // The same 720 the nav uses — the side panel is carved out of
            // that width rather than added to it, so the page still lines up
            // with the nav above it.
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
