import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { assetServer } from '../assets.ts'
import type { Db } from '../data/db.ts'
import { countFollowing } from '../data/follows.ts'
import { listFollowingLogActivity } from '../data/mediaItems.ts'
import { getLuckyState } from '../data/recommendations/lucky.ts'
import { listRecommendationRuns, listRecommendationRunsFromOthers } from '../data/recommendations/runs.ts'
import type { User } from '../data/schema.ts'
import { displayLabel } from '../data/users.ts'
import { getRememberedMediaType } from '../middleware/mediaType.ts'
import { routes } from '../routes.ts'
import { HomePage, type HomeDashboard } from './home-page.tsx'
import { MEDIA_TYPE_UI } from '../mediaTypes.ts'

// A landing page, not a log: enough of each list to show what's there, with the
// page that owns it a click away.
const RUNS_SHOWN = 3
const ACTIVITY_SHOWN = 8

async function loadDashboard(db: Db, user: User): Promise<HomeDashboard> {
  // Unfiltered by media type on purpose — the recommendations index is the
  // per-type view, and this one answers "what has happened lately".
  const [lucky, runs, runsFromOthers, followingActivity, followingCount] = await Promise.all([
    getLuckyState(user),
    listRecommendationRuns(db, user.id),
    listRecommendationRunsFromOthers(db, user.id),
    listFollowingLogActivity(db, user.id, ACTIVITY_SHOWN),
    countFollowing(db, user.id),
  ])

  return {
    displayName: displayLabel(user),
    lucky,
    runs: runs.slice(0, RUNS_SHOWN),
    runsFromOthers: runsFromOthers.slice(0, RUNS_SHOWN),
    followingActivity,
    followsAnyone: followingCount > 0,
  }
}

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    async home(context) {
      const auth = context.get(Auth)
      // Nothing is loaded for a visitor: the dashboard is the only thing on
      // this page that touches the database, and they have none of it.
      if (!auth.ok) return context.render(<HomePage dashboard={null} />)

      const db = context.get(Database)
      return context.render(<HomePage dashboard={await loadDashboard(db, auth.identity)} />)
    },
    media(context) {
      return redirect(MEDIA_TYPE_UI[getRememberedMediaType(context)].hrefs.search(), 303)
    },
  },
})
