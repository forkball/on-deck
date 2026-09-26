import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { assetServer } from '../assets.ts'
import type { Db } from '../data/db.ts'
import { loadGroupedFeedPage, type FeedCursor, type FeedRowCursor } from '../data/feed.ts'
import { countFollowing } from '../data/follows.ts'
import { getLuckyState } from '../data/recommendations/lucky.ts'
import type { User } from '../data/schema.ts'
import { displayLabel } from '../data/users.ts'
import { routes } from '../routes.ts'
import { FeedRows } from './activity-feed.tsx'
import { HomePage, type HomeDashboard } from './home-page.tsx'

// One screenful and a bit. Small enough that the landing page isn't paying for
// rows nobody scrolls to, big enough that the first auto-load isn't immediate.
const FEED_PAGE = 10

async function loadDashboard(db: Db, user: User): Promise<HomeDashboard> {
  // Unfiltered by media type on purpose — the recommendations index is the
  // per-type view, and this one answers "what has happened lately".
  const [lucky, page] = await Promise.all([getLuckyState(user), loadGroupedFeedPage(db, user.id, FEED_PAGE)])

  return {
    displayName: displayLabel(user),
    lucky,
    feed: page.items,
    feedCursor: page.cursor,
    // Only asked when the feed came back empty: anything in it already proves
    // there is something to show, and this is the landing page — a round trip
    // whose answer is usually discarded is one worth not making.
    followsAnyone: page.items.length > 0 || (await countFollowing(db, user.id)) > 0,
  }
}

// The cursor arrives as whatever the last response put in the query string.
// Anything that isn't the shape we sent back is treated as no cursor at all —
// a feed that restarts from the top is a much better answer to a mangled URL
// than a 500, and there is nothing here worth defending beyond that.
function parseRowCursor(value: unknown): FeedRowCursor | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object') return undefined
  const { at, id } = value as Record<string, unknown>
  return typeof at === 'number' && typeof id === 'number' ? { at, id } : undefined
}

function parseFeedCursor(raw: string | null): FeedCursor | undefined {
  if (!raw) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const cursor: FeedCursor = {}
  for (const key of ['log', 'runsFromOthers'] as const) {
    // Left absent when the slot is missing or malformed, which reads as "start
    // this source from the newest" — see FeedCursor.
    const slot = parseRowCursor((parsed as Record<string, unknown>)[key])
    if (slot !== undefined) cursor[key] = slot
  }
  return cursor
}

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    async home(context) {
      const auth = context.get(Auth)
      // Nothing is loaded for a visitor: the dashboard is the only thing on
      // this page that touches the database, and they have none of it.
      if (!auth.ok) return context.render(<HomePage dashboard={null} />)

      const db = context.get(Database)
      return context.render(<HomePage dashboard={await loadDashboard(db, auth.identity)} />)
    },
    // The rest of the home feed, for the auto-loader. Answers the rows as
    // markup rather than as data: they are built from components under app/ui
    // that a client bundle can't import, so rendering them here is what keeps an
    // appended row identical to a server-rendered one.
    async feed(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const page = await loadGroupedFeedPage(
        db,
        auth.identity.id,
        FEED_PAGE,
        parseFeedCursor(context.url.searchParams.get('cursor')),
      )

      // Rendered to a string rather than streamed: it is going into a JSON
      // field beside the cursor, and the caller needs both together.
      const html = await context.render(<FeedRows items={page.items} />).text()

      return Response.json({ html, cursor: page.cursor && JSON.stringify(page.cursor) })
    },
    media() {
      return redirect(routes.movies.search.href(), 303)
    },
  },
})
