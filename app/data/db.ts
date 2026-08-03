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

// A search page fans out ~20 concurrent upserts, and round-trips are ~45ms, so
// the pg default of 10 connections made queueing the dominant cost.
// For the one query the table API can't express: title matching that needs
// regexp_replace in SQL. See resolveFromCatalog.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })

export const db = createDatabase(createPostgresDatabaseAdapter(pool))
export type Db = typeof db

export function loadDatabase(): Middleware<{ key: typeof Database; value: Db }> {
  return async (context, next) => {
    context.set(Database, db)
    return next()
  }
}
