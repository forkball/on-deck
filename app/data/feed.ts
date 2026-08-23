import type { Db } from './db.ts'
import { listFollowingLogActivity, type FollowingLogEntry } from './mediaItems.ts'
import {
  listRecommendationRuns,
  listRecommendationRunsFromOthers,
  type RecommendationRunSummary,
} from './recommendations/runs.ts'

// One row of the home page's activity feed. Recommendation runs and log entries
// are interleaved by time rather than kept in sections of their own, so the row
// has to say which of the two it is — `kind` is what the page switches on.
//
// `at` is the timestamp the merge orders by, lifted out of whichever field the
// source calls it (`updated_at` for a log entry, `created_at` for a run) so the
// sort doesn't need to know. `id` is only ever compared within one source, since
// the two tables number their rows independently.
export type FeedItem =
  | { kind: 'log'; at: number; id: number; entry: FollowingLogEntry }
  | { kind: 'run'; at: number; id: number; run: RecommendationRunSummary }

// The three lists the feed is merged from. Runs you generated and runs someone
// else generated for you are separate sources rather than one, because they are
// separate queries with separate rules about what you may see.
const SOURCES = ['log', 'runs', 'runsFromOthers'] as const
type SourceName = (typeof SOURCES)[number]

// Where one source resumes from. Structurally what both LogCursor and RunCursor
// are — the row's ordering timestamp and its id — and assignable to either,
// which is what lets the slots below be one type rather than a mapped one.
export interface FeedRowCursor {
  at: number
  id: number
}

// Where to resume, one slot per source, in the three states a source can be in:
//
//   absent — not read from yet, so start at the newest
//   a cursor — resume after this row
//   null — exhausted, don't ask again
//
// Per source rather than one shared timestamp, because the sources are paged
// independently: a page can take five log rows and one run, and the next page
// has to continue each of them from where it actually stopped. A shared cursor
// would either re-read what a source hadn't reached or skip what it had.
export type FeedCursor = { [K in SourceName]?: FeedRowCursor | null }

export interface FeedPage {
  items: FeedItem[]
  // Null once every source is exhausted — which is what lets the page stop
  // asking, rather than discovering it from an empty response a round trip later.
  cursor: FeedCursor | null
}

function sourceOf(item: FeedItem): SourceName {
  if (item.kind === 'log') return 'log'
  // Whose run it is decides which query produced it: `owner` is null only for
  // the viewer's own, which is exactly what listRecommendationRuns returns.
  return item.run.owner === null ? 'runs' : 'runsFromOthers'
}

// One page of the merged feed.
//
// Each source is asked for a full page of its own, because any one of them
// could supply the whole page — a burst of runs, or a friend importing a
// library — and asking for a share apiece would cut the page short whenever the
// mix wasn't even. The surplus is discarded rather than remembered: each
// source's cursor advances only to the last of its rows that actually made the
// page, so the next call re-reads what it didn't use.
export async function loadFeedPage(
  db: Db,
  userId: number,
  limit: number,
  from: FeedCursor = {},
): Promise<FeedPage> {
  // `null` means exhausted, so that source is skipped without a query.
  const [logEntries, runs, runsFromOthers] = await Promise.all([
    from.log === null ? [] : listFollowingLogActivity(userId, limit, from.log),
    from.runs === null ? [] : listRecommendationRuns(db, userId, undefined, limit, from.runs),
    from.runsFromOthers === null
      ? []
      : listRecommendationRunsFromOthers(db, userId, undefined, limit, from.runsFromOthers),
  ])

  const returned: Record<SourceName, number> = {
    log: logEntries.length,
    runs: runs.length,
    runsFromOthers: runsFromOthers.length,
  }

  const candidates: FeedItem[] = [
    ...logEntries.map(
      (entry): FeedItem => ({ kind: 'log', at: entry.interaction.updated_at, id: entry.interaction.id, entry }),
    ),
    ...[...runs, ...runsFromOthers].map(
      (run): FeedItem => ({ kind: 'run', at: run.createdAt, id: run.id, run }),
    ),
  ]

  // Descending by time; id breaks ties within a source, and `kind` settles what
  // is left so two tables sharing a millisecond still order the same way twice.
  candidates.sort((a, b) => b.at - a.at || b.id - a.id || a.kind.localeCompare(b.kind))
  const items = candidates.slice(0, limit)

  const taken: Record<SourceName, number> = { log: 0, runs: 0, runsFromOthers: 0 }
  const cursor: FeedCursor = { ...from }

  for (const item of items) {
    const source = sourceOf(item)
    taken[source] += 1
    // Sorted newest first, so the last one seen is the oldest this page used.
    cursor[source] = { at: item.at, id: item.id }
  }

  // A source is finished only when its query had nothing more to give *and*
  // every row it gave made the page. Fewer rows than asked for means the table
  // is read out; rows left on the cutting-room floor are still owed to the
  // reader, and come back on the next call from the same cursor.
  let exhausted = true
  for (const source of SOURCES) {
    const finished = returned[source] < limit && taken[source] === returned[source]
    if (finished) cursor[source] = null
    else exhausted = false
  }

  return { items, cursor: exhausted ? null : cursor }
}
