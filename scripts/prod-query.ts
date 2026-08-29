// Runs one read-only SELECT against production and prints the rows.
//
// It exists so that inspecting production is a narrow, reviewable capability
// rather than a general "run node against the prod connection string" — see
// .claude/settings.local.json, which allows this script and nothing wider.
//
//   npm run prod:query -- "select id, external_source from media_items where id = 1574"
//
// Reads PRODUCTION_DATABASE_URL, never DATABASE_URL: a script whose whole
// purpose is to touch production should say so, not inherit whatever the
// ambient environment happens to point at.

import { Pool } from 'pg'

const sql = process.argv.slice(2).join(' ').trim()

if (!sql) {
  console.error('Usage: npm run prod:query -- "select ..."')
  process.exit(1)
}

const url = process.env.PRODUCTION_DATABASE_URL
if (!url) {
  console.error('PRODUCTION_DATABASE_URL is not set.')
  process.exit(1)
}

// First gate, and the weaker of the two: a regex over SQL is a guess about a
// grammar it does not parse. It is here to reject the obvious mistake early
// with a clear message; the transaction below is what actually holds.
const withoutTrailingSemicolon = sql.replace(/;\s*$/, '')

if (!/^select\s/i.test(withoutTrailingSemicolon)) {
  console.error('Refused: only a SELECT can be run through this script.')
  process.exit(1)
}

// Anything after the first statement would ride along on the same call.
if (withoutTrailingSemicolon.includes(';')) {
  console.error('Refused: one statement at a time — the query contains a ";".')
  process.exit(1)
}

const pool = new Pool({
  connectionString: url,
  // Postgres enforces this, so a write refuses at the server no matter what
  // the checks above failed to notice. This is the real guarantee.
  options: '-c default_transaction_read_only=on -c statement_timeout=15s',
})

try {
  const client = await pool.connect()
  try {
    // Explicit as well as the session default: a read-only transaction is what
    // makes "read-only" a property of the connection rather than a promise
    // about the string.
    await client.query('begin transaction read only')
    const result = await client.query(withoutTrailingSemicolon)
    // Rolled back rather than committed — there is nothing to commit, and this
    // way the script has no successful-write path at all.
    await client.query('rollback')

    console.log(`${result.rowCount} row(s)`)
    if (result.rows.length > 0) console.table(result.rows)
  } finally {
    client.release()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
