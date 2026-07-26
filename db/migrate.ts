import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'
import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'

const directionArg = process.argv[2] ?? 'up'
const direction = directionArg === 'down' ? 'down' : 'up'

const sqlite = new DatabaseSync(process.env.DATABASE_PATH ?? './db/app.db')
sqlite.exec('PRAGMA foreign_keys = ON')
const adapter = createSqliteDatabaseAdapter(sqlite)

const migrations = await loadMigrations(path.resolve('db/migrations'))
const runner = createMigrationRunner(adapter, migrations)

const result = direction === 'up' ? await runner.up() : await runner.down()
console.log(direction, 'complete', {
  applied: result.applied.map((entry) => entry.id),
  reverted: result.reverted.map((entry) => entry.id),
})
