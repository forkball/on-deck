// One-off backfill: works out every member's credits from what they have
// already logged, so a title is there on the day titles ship rather than on
// whichever day each member next logs something or opens their own profile.
// Without it, someone who doesn't come back shows no title to anyone, since
// viewing a profile only reads credits and never works them out.
//
// Runs the app's own checkTitleUnlocks per member, so it records exactly what a
// page load would: the credits earned, the starter title put on anyone wearing
// nothing, and one notification listing what they earned — which is how they
// find out titles exist. Pass --quiet to record without notifying.
//
// Safe to run more than once: credits already recorded are skipped, nobody is
// notified about a credit twice, and a title someone chose is never replaced.
//
// Dry run by default — prints what each member would earn without writing
// anything. Pass --apply to write, --user=<display name> to do one member, and
// --production to run against PRODUCTION_DATABASE_URL. That flag is the only
// way this reaches production; without it the connection is DATABASE_URL — see
// scripts/backfill-google-books.ts for why. `npm run prod:backfill-titles` is
// that spelling.
//
// Deliberately its own pool rather than the app's (app/data/db.ts) — see
// db/migrate.ts for why. unlocks.ts takes the database it is handed for this.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { earnedTitleKeys, titleByKey } from '../app/data/profileTitles/catalog.ts'
import {
  checkTitleUnlocks,
  loadTitleStats,
  loadUnlockedTitleKeys,
} from '../app/data/profileTitles/unlocks.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const APPLY = process.argv.includes('--apply')
const QUIET = process.argv.includes('--quiet')
const PRODUCTION = process.argv.includes('--production')
const userArg = process.argv.find((arg) => arg.startsWith('--user='))
const ONLY_USER = userArg ? userArg.slice('--user='.length) : undefined

const CONNECTION = PRODUCTION ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL

const pool = new Pool({ connectionString: CONNECTION })
const db = createDatabase(createPostgresDatabaseAdapter(pool))

function words(keys: string[]): string {
  return keys.map((key) => titleByKey(key)?.word ?? key).join(', ')
}

async function main() {
  if (!CONNECTION) {
    throw new Error(PRODUCTION ? 'PRODUCTION_DATABASE_URL is required' : 'DATABASE_URL is required')
  }

  console.log(
    `Database: ${PRODUCTION ? 'PRODUCTION' : 'development'}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}` +
      `${APPLY && QUIET ? ', no notifications' : ''}.`,
  )

  const { rows: members } = await pool.query<{ id: number; display_name: string }>(
    `select id, display_name from users ${ONLY_USER ? 'where display_name = $1' : ''} order by id`,
    ONLY_USER ? [ONLY_USER] : [],
  )
  if (ONLY_USER && members.length === 0) throw new Error(`no member named ${ONLY_USER}`)

  let credited = 0
  let creditsTotal = 0
  let failed = 0

  // One at a time: a few queries each, and nothing here is waiting on anyone.
  for (const member of members) {
    try {
      let fresh: string[]
      if (APPLY) {
        fresh = (await checkTitleUnlocks(db, member.id, { notify: !QUIET })).newlyUnlocked
      } else {
        const [stats, held] = await Promise.all([
          loadTitleStats(db, member.id),
          loadUnlockedTitleKeys(db, member.id),
        ])
        fresh = earnedTitleKeys(stats).filter((key) => !held.has(key))
      }

      if (fresh.length > 0) {
        credited++
        creditsTotal += fresh.length
        console.log(`  ${member.display_name}: ${fresh.length} — ${words(fresh)}`)
      }
    } catch (error) {
      failed++
      console.error(`  ${member.display_name}: failed`, error)
    }
  }

  console.log(
    `\n${members.length} members checked; ${credited} ${APPLY ? 'earned' : 'would earn'} ` +
      `${creditsTotal} credits between them${failed ? `; ${failed} failed` : ''}.` +
      (APPLY ? '' : ' Nothing written — pass --apply to record them.'),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
