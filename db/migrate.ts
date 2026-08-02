import path from 'node:path'
import { Pool } from 'pg'

import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'
import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'

const directionArg = process.argv[2] ?? 'up'
const direction = directionArg === 'down' ? 'down' : 'up'

// How many migrations `down` reverts. One by default, because `runner.down()`
// with no options reverts *every* applied migration — running `db:migrate:down`
// to undo the last change would otherwise drop the entire schema. Pass a count
// (`db:migrate:down 3`) or `all` to opt into more.
const stepArg = process.argv[3]
const downStep = stepArg === 'all' ? undefined : Math.max(1, Number(stepArg) || 1)

// Deliberately its own pool rather than the app's (app/data/db.ts): importing
// that would pull the whole app module graph and its 20-connection pool into a
// script that needs neither.
//
// lock_timeout, not statement_timeout: this bounds how long a statement waits
// to *acquire* a lock, so DDL that lands behind a slow query fails fast rather
// than queueing and stalling every read of that table behind it. A backfill
// can legitimately run for minutes, so total runtime is left unbounded — a
// migration that wants a ceiling can set one itself.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c lock_timeout=5s',
})

// Arbitrary but stable — any process migrating this database has to use the
// same key for the lock to mean anything.
const LOCK_KEY = 8_090_2026
const LOCK_WAIT_MS = 30_000
const LOCK_RETRY_MS = 500

// The migration runner has no locking of its own, so two processes migrating
// at once both read the journal, both see the same pending migration, and both
// try to apply it. Fly's release_command makes that unlikely (one throwaway
// machine, run before the release goes out), but this is what also makes a
// stray manual `npm run db:migrate` against production safe.
//
// Bounded rather than a plain pg_advisory_lock, which waits forever: a hung
// deploy is worse than a failed one, and the lock_timeout above does not apply
// to advisory locks.
async function acquireLock(): Promise<() => Promise<void>> {
  const client = await pool.connect()
  const deadline = Date.now() + LOCK_WAIT_MS

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [LOCK_KEY],
    )
    if (rows[0].locked) break

    if (Date.now() >= deadline) {
      client.release()
      throw new Error(
        `Timed out after ${LOCK_WAIT_MS}ms waiting for the migration lock — another migration is already running.`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
  }

  // Session-scoped, so it is held until this client is released. The
  // migrations themselves run on other pool connections; the lock only has to
  // be held by *some* session to keep a second migrator out.
  return async () => {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY])
    client.release()
  }
}

let exitCode = 0

try {
  const releaseLock = await acquireLock()

  try {
    const adapter = createPostgresDatabaseAdapter(pool)
    const migrations = await loadMigrations(path.resolve('db/migrations'))
    const runner = createMigrationRunner(adapter, migrations)

    const result =
      direction === 'up'
        ? await runner.up()
        : await runner.down(downStep === undefined ? undefined : { step: downStep })
    console.log(direction, 'complete', {
      applied: result.applied.map((entry) => entry.id),
      reverted: result.reverted.map((entry) => entry.id),
    })
  } finally {
    await releaseLock()
  }
} catch (error) {
  // A non-zero exit is what makes Fly abort the deploy and leave the previous
  // release serving, so this must never be swallowed.
  console.error('Migration failed:', error)
  exitCode = 1
} finally {
  await pool.end()
}

process.exit(exitCode)
