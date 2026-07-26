import { DatabaseSync } from 'node:sqlite'

import { createDatabase, Database } from 'remix/data-table'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'
import type { Middleware } from 'remix/router'

const sqlite = new DatabaseSync(process.env.DATABASE_PATH ?? './db/app.db')
sqlite.exec('PRAGMA foreign_keys = ON')

export const db = createDatabase(createSqliteDatabaseAdapter(sqlite))
export type Db = typeof db

export function loadDatabase(): Middleware<{ key: typeof Database; value: Db }> {
  return async (context, next) => {
    context.set(Database, db)
    return next()
  }
}
