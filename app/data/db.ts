import { Pool } from 'pg'

import { createDatabase, Database } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'
import type { Middleware } from 'remix/router'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDatabase(createPostgresDatabaseAdapter(pool))
export type Db = typeof db

export function loadDatabase(): Middleware<{ key: typeof Database; value: Db }> {
  return async (context, next) => {
    context.set(Database, db)
    return next()
  }
}
