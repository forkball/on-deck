import path from 'node:path'
import { Pool } from 'pg'

import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'
import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'

const directionArg = process.argv[2] ?? 'up'
const direction = directionArg === 'down' ? 'down' : 'up'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = createPostgresDatabaseAdapter(pool)

const migrations = await loadMigrations(path.resolve('db/migrations'))
const runner = createMigrationRunner(adapter, migrations)

const result = direction === 'up' ? await runner.up() : await runner.down()
console.log(direction, 'complete', {
  applied: result.applied.map((entry) => entry.id),
  reverted: result.reverted.map((entry) => entry.id),
})

await pool.end()
