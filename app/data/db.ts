import { Pool, types } from 'pg'

import { createDatabase, Database } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'
import type { Middleware } from 'remix/router'

// pg returns int8 as strings (they can exceed MAX_SAFE_INTEGER). Ours only hold
// epoch-ms, and `new Date()` on a numeric string parses it as a date string
// rather than a timestamp.
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
// Same for NUMERIC (rating, popularity_score): a string rating breaks strict
// equality like the star input's `defaultValue === step`.
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

// 20 rather than pg's default 10: a search page fans out ~20 concurrent upserts
// at ~45ms a round trip, so a smaller pool makes queueing the dominant cost.
//
// Exported for the queries the table API can't express. The table API is the
// default; dropping to `pool.query` is the exception, and each one is here for
// a reason SQL alone can carry:
//
//   - Atomic claims under concurrency — `for update skip locked` queue drains
//     (jobs.ts, batches.ts) and the partial-index upsert that enforces one live
//     job per user (jobs.ts). Correctness depends on the lock, not just the rows.
//   - Aggregates and correlated subqueries — `count(*)`, `group by`,
//     `join lateral`, `array_agg(... order by ...)` (mediaItems.ts, lucky.ts,
//     jobs.ts).
//   - Set-at-a-time writes — a `case when` conditional update, a multi-row
//     `values` list built from one array (jobs.ts, batches.ts).
//   - regexp_replace title matching (matching.ts). The original reason.
//
// A new raw query wants to name which of these it is. If it is reaching for raw
// SQL to express a filter, try `remix/data-table/operators` first.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })

export const db = createDatabase(createPostgresDatabaseAdapter(pool))
export type Db = typeof db

export function loadDatabase(): Middleware<{ key: typeof Database; value: Db }> {
  return async (context, next) => {
    context.set(Database, db)
    return next()
  }
}
