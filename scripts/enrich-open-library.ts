// Fills in the one thing Open Library rows are missing: the description.
//
// Open Library's search index carries no description at all — openLibrary.ts says so
// where it sets `overview: null` — and the works endpoint that does carry one is a
// second request per result, too many to spend while someone is typing. So a row only
// ever gets its description when somebody opens that book's page and
// backfillCatalogDetail fetches it in the background. Measured in production: 7 of 174
// rows had ever been opened, and 4 carried a description.
//
// That shortfall is not cosmetic. An overview is what verifyPicksAgainstOverviews
// reads to decide a recommendation is really the book it asked for, and what the local
// catalogue shortcut requires before it will answer for a row at all
// (recommendations/matching.ts). Without one a row is excluded from both, so 170 rows
// were sitting in people's shelves unable to take part in anything.
//
// Deliberately separate from backfill-google-books.ts, which moves rows to a different
// provider and spends a quota doing it. This asks Open Library about rows that are
// already Open Library's, so it costs nothing anyone else is competing for and is
// worth running whatever happens to those rows later.
//
// Dry run by default. --apply writes, --limit=N caps the rows, --production reads
// PRODUCTION_DATABASE_URL rather than DATABASE_URL.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { getWorkById } from '../app/data/catalog/openLibrary.ts'
import { upsertCatalogItem } from '../app/data/catalog/provider.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined

const CONNECTION = PRODUCTION ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL

const pool = new Pool({ connectionString: CONNECTION })
const db = createDatabase(createPostgresDatabaseAdapter(pool))

// Open Library asks anonymous callers to stay under 1 request/second and identified
// ones under 3. openLibrary.ts sends a contact address, so this takes the 3 and leaves
// room under it — there is no deadline here worth being rude for.
const MIN_GAP_MS = 400

async function politely<T>(work: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    return await work()
  } finally {
    const waited = Date.now() - started
    if (waited < MIN_GAP_MS) await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - waited))
  }
}

interface Row {
  id: number
  external_id: string
  title: string
}

async function main() {
  if (!CONNECTION) {
    throw new Error(PRODUCTION ? 'PRODUCTION_DATABASE_URL is required' : 'DATABASE_URL is required')
  }

  // Rows with a description already are left alone whether or not they were ever
  // formally enriched: the description is the thing being chased, not the stamp.
  const { rows: all } = await pool.query<Row>(
    `select id, external_id, title
       from media_items
      where type = 'book'
        and external_source = 'openlibrary'
        and coalesce(metadata->>'overview', '') = ''
      order by id`,
  )
  const rows = LIMIT ? all.slice(0, LIMIT) : all

  console.log(
    `${rows.length} Open Library book row(s) with no description. ` +
      `Database: ${PRODUCTION ? 'PRODUCTION' : 'development'}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`,
  )

  let described = 0
  let silent = 0
  let failed = 0

  // One at a time. The whole job is a few minutes at this rate and nothing is waiting
  // on it, so there is nothing to buy by leaning on a catalogue that asks us not to.
  for (const row of rows) {
    try {
      const detail = await politely(() => getWorkById(row.external_id))

      if (!detail?.overview) {
        silent++
        console.log(`[none]      row ${row.id} "${row.title}" — Open Library has no description either`)
        continue
      }

      described++
      const words = detail.overview.split(/\s+/).length
      console.log(`[described] row ${row.id} "${row.title}" — ${words} words`)

      // Everything but the description is already better on the row than in the work
      // record — getWorkById answers with no author, no page count and no readership —
      // and buildMetadata keeps the stored value wherever the lookup has none, so the
      // upsert can only add.
      if (APPLY) await upsertCatalogItem(db, 'book', detail, true)
    } catch (error) {
      failed++
      console.error(
        `[failed]    row ${row.id} "${row.title}" — ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  console.log(`\n${described} described, ${silent} with nothing to add, ${failed} failed`)
  if (!APPLY) console.log('Dry run — nothing was written. Re-run with --apply.')

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
