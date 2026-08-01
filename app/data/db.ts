import { Pool, types } from 'pg'

import { createDatabase, Database } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'
import type { Middleware } from 'remix/router'

// pg returns bigint (int8) columns as strings by default, since they can
// exceed Number.MAX_SAFE_INTEGER. Our bigint columns only ever hold epoch-ms
// timestamps (see db/migrations), which are well within that range, so parse
// them as numbers — otherwise `new Date(createdAt)` gets a numeric string,
// which Date parses as a date string rather than a timestamp.
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
// Same story for numeric/decimal columns (rating, popularity_score): pg
// returns them as strings since NUMERIC can exceed float precision, but ours
// only ever hold small ratings/scores, and a string rating breaks strict
// equality checks like the star-rating input's `defaultValue === step`.
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

// A single search page fans out ~20 concurrent upserts; the pg default of
// 10 connections made half of them queue behind the others for no reason.
// Round-trips to the hosted database are ~45ms, so queueing is the dominant
// cost, not query time.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })

export const db = createDatabase(createPostgresDatabaseAdapter(pool))
export type Db = typeof db

export function loadDatabase(): Middleware<{ key: typeof Database; value: Db }> {
  return async (context, next) => {
    context.set(Database, db)
    return next()
  }
}
