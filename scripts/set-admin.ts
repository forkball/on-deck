// Grants or revokes the admin flag on one account. Admin is a maintenance
// role, not something users hand each other, so it has no UI and no route —
// this script is the only way to set it.
//
// Two effects today: exemption from the daily recommendation cap (see
// app/data/recommendations/dailyLimit.ts), and access to the Letterboxd feed
// sync before LETTERBOXD_FEED_SYNC opens it to everyone (see
// letterboxdSyncAvailableTo in app/data/imports/letterboxdFeed.ts).
//
//   node --env-file-if-exists=.env --import remix/node-tsx scripts/set-admin.ts someone@example.com
//   node --env-file-if-exists=.env --import remix/node-tsx scripts/set-admin.ts someone --revoke
//
// The identifier is an email address or a username, matched the same way login
// matches them (see actions/auth/login/controller.tsx).
//
// Deliberately its own pool rather than the app's (app/data/db.ts) — see
// db/migrate.ts for why.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { users } from '../app/data/schema.ts'
import { displayLabel, findUserByEmail, findUserByUsername } from '../app/data/users.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const REVOKE = process.argv.includes('--revoke')
const identifier = process.argv.slice(2).find((arg) => !arg.startsWith('--'))

if (!identifier) {
  console.error('Usage: set-admin.ts <email-or-username> [--revoke]')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = createDatabase(createPostgresDatabaseAdapter(pool))

try {
  // Emails are stored lowercased (see users.ts), so a typed-in address only
  // matches once it's folded the same way.
  const user =
    (await findUserByEmail(db, identifier.trim().toLowerCase())) ?? (await findUserByUsername(db, identifier.trim()))

  if (!user) {
    console.error(`No account matches ${identifier}.`)
    process.exit(1)
  }

  if (user.is_admin === !REVOKE) {
    console.log(`${displayLabel(user)} is already ${REVOKE ? 'not an admin' : 'an admin'} — nothing to do.`)
  } else {
    await db.update(users, user.id, { is_admin: !REVOKE })
    console.log(`${REVOKE ? 'Revoked admin from' : 'Granted admin to'} ${displayLabel(user)} (id ${user.id}).`)
  }
} finally {
  await pool.end()
}
