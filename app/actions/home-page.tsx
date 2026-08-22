import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { FollowingLogEntry } from '../data/mediaItems.ts'
import type { MediaType } from '../data/mediaItems.ts'
import { parseMediaMetadata } from '../data/mediaMetadata.ts'
import type { RecommendationRunSummary } from '../data/recommendations/runs.ts'
import { mediaTypeUiFor, statusLabel } from '../mediaTypes.ts'
import { routes } from '../routes.ts'
import { Document } from '../ui/components/document.tsx'
import { Nav } from '../ui/components/nav.tsx'
import { RunList } from '../ui/components/run-list.tsx'
import { DislikedDisplay, StarRatingDisplay } from '../ui/components/star-rating.tsx'

// What the home page needs of a lucky pick, independent of how one gets picked
// — that lives elsewhere. A pick that has already been logged still shows here;
// it's what today's pick *is*, not a to-do list.
export interface LuckyPickView {
  mediaItemId: number
  mediaType: MediaType
  title: string
  posterUrl: string | null
  // Whatever chose it, in its own words. Null when it didn't say.
  reason: string | null
  pickedAt: number
}

export interface HomeDashboard {
  displayName: string
  // Null until today's pick has been rolled — the section renders the call to
  // action instead.
  luckyPick: LuckyPickView | null
  // Where the call to action goes. A prop rather than a route read straight
  // from the registry, because the action that rolls a pick isn't built yet:
  // when it lands, this is the one line that changes.
  luckyPickHref: string
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

const CARD = {
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '16px',
} as const

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// The heading over it already says "today", so a date under the pick only earns
// its place on a pick that somehow isn't from today.
function describePickedAt(value: number): string {
  const picked = new Date(value)
  return picked.toDateString() === new Date().toDateString()
    ? 'picked today'
    : `picked ${formatDate(value)}`
}

function Section(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => {
    const { title, children } = handle.props

    return (
      <section mix={css({ marginTop: '40px' })}>
        <h2 mix={css({ margin: '0 0 12px' })}>{title}</h2>
        {children}
      </section>
    )
  }
}

// The empty state every list here shares: one quiet line, and a way out of it.
function Empty(handle: Handle<{ children?: RemixNode }>) {
  return () => <p mix={css({ margin: 0, color: '#555' })}>{handle.props.children}</p>
}

function Poster(handle: Handle<{ url: string | null; title: string; href?: string; width: number }>) {
  return () => {
    const { url, title, href, width } = handle.props
    const height = Math.round(width * 1.5)

    if (!url) {
      return (
        <div
          mix={css({
            width: `${width}px`,
            height: `${height}px`,
            flex: '0 0 auto',
            border: '1px solid #ddd',
            borderRadius: '4px',
          })}
        />
      )
    }

    const image = (
      <img
        src={url}
        alt={`${title} poster`}
        mix={css({ width: `${width}px`, borderRadius: '4px', display: 'block' })}
      />
    )

    return href ? (
      <a href={href} mix={css({ flex: '0 0 auto' })}>
        {image}
      </a>
    ) : (
      <div mix={css({ flex: '0 0 auto' })}>{image}</div>
    )
  }
}

function LuckyPickCard(handle: Handle<{ pick: LuckyPickView }>) {
  return () => {
    const { pick } = handle.props
    const ui = mediaTypeUiFor(pick.mediaType)
    const href = ui.hrefs.show(pick.mediaItemId)

    return (
      <div mix={css({ ...CARD, display: 'flex', gap: '16px' })}>
        <Poster url={pick.posterUrl} title={pick.title} href={href} width={64} />
        <div>
          <a href={href}>
            <strong>{pick.title}</strong>
          </a>
          <p mix={css({ margin: '4px 0 0', fontSize: '13px', color: '#888' })}>
            {ui.singular} — {describePickedAt(pick.pickedAt)}
          </p>
          {pick.reason && <p mix={css({ margin: '8px 0 0', fontStyle: 'italic' })}>{pick.reason}</p>}
        </div>
      </div>
    )
  }
}

// Deliberately a whole panel rather than a line of text with a link: on a day
// nothing has been picked this is the page's one thing to do.
function LuckyPickCta(handle: Handle<{ href: string }>) {
  return () => {
    return (
      <div mix={css({ ...CARD, display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' })}>
        <p mix={css({ margin: 0 })}>
          <strong>Nothing picked yet today.</strong>
        </p>
        <p mix={css({ margin: 0, color: '#555' })}>
          One thing to watch, read or play, chosen out of everything you're sitting on — once a day.
        </p>
        <a href={handle.props.href} class="doodle-border" mix={css({ textDecoration: 'none' })}>
          Pick today's
        </a>
      </div>
    )
  }
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
              <Poster url={posterUrl} title={title} href={detailHref} width={48} />
              <div>
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

function Dashboard(handle: Handle<{ dashboard: HomeDashboard }>) {
  return () => {
    const { luckyPick, luckyPickHref, runs, runsFromOthers, followingActivity, followsAnyone } =
      handle.props.dashboard

    return (
      <>
        <Section title="Today's lucky pick">
          {luckyPick ? <LuckyPickCard pick={luckyPick} /> : <LuckyPickCta href={luckyPickHref} />}
        </Section>

        <Section title="Recommendation runs">
          <h3 mix={css({ margin: '0 0 8px', fontSize: '15px' })}>Yours</h3>
          {runs.length > 0 ? (
            <RunList runs={runs} showMediaType={true} />
          ) : (
            <Empty>
              None yet — <a href={routes.recommendations.index.href()}>generate one</a> from what you've
              logged.
            </Empty>
          )}

          <h3 mix={css({ margin: '24px 0 8px', fontSize: '15px' })}>Run for you</h3>
          {runsFromOthers.length > 0 ? (
            <RunList runs={runsFromOthers} showMediaType={true} />
          ) : (
            <Empty>
              Nothing yet — group runs someone else generated show up here once you both follow each other.
            </Empty>
          )}
        </Section>

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
      </>
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
            // 720 rather than the 640 this page used before, so its cards line
            // up with the nav above them and with every other signed-in page.
            maxWidth: '720px',
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
