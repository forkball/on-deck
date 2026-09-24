// One-off retag: rewrites the genre tags on book rows stored from a Google Books
// *search* hit.
//
// A search hit carries the top-level BISAC category and nothing under it —
// "Fiction" for Dune — so the genres derived from it come out empty, and until
// the change this script ships with it also carried a fabricated "standalone",
// built from a seriesInfo field the API no longer returns for any volume. Both
// reach the genre filter through resolveFromCatalog, which hands a stored row's
// tags over as though they were an answer. filterByGenre now pays for a by-id
// lookup when a row can't answer; this is what stops it paying for these same
// rows on every run.
//
// Dry run by default — prints what it would write without writing. Pass --apply
// to write, --limit=N to try a handful first. Re-runnable: a row already holding
// what Google answers reports unchanged.
//
// Only metadata.tags is written. The rest is left alone, and the enrichedAt stamp
// with it — this script has not looked at credits or stills, so stamping the row
// enriched would stop backfillCatalogDetail ever fetching them.
//
// Its own pool rather than the app's, and its own throttle rather than importing
// backfill-google-books.ts's — that script is a one-off in the same shape, and
// importing it would run it.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { BOOK_GENRES, getBookById } from '../app/data/catalog/googleBooks.ts'
import { runBounded } from '../app/data/imports/csv.ts'
import { parseMediaMetadata } from '../app/data/mediaMetadata.ts'
import { mediaItems, type MediaItem } from '../app/data/schema.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = createDatabase(createPostgresDatabaseAdapter(pool))

// Google Books' quota is 100 requests/minute/user, and this walks every book row
// in one go. Same sliding window as backfill-google-books.ts, which measured a
// plain run losing ~95 of 299 rows to 429s without one.
const RATE_LIMIT = 80
const RATE_WINDOW_MS = 60_000
const callTimes: number[] = []

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (callTimes.length > 0 && now - callTimes[0] > RATE_WINDOW_MS) callTimes.shift()
    if (callTimes.length < RATE_LIMIT) {
      callTimes.push(now)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, RATE_WINDOW_MS - (now - callTimes[0])))
  }
}

const genres = new Set(BOOK_GENRES)

// A row worth a request: one carrying no genre at all, or carrying the series tag
// that is no longer derived. Anything else already holds what a lookup would say.
function needsRetag(tags: string[]): boolean {
  if (tags.some((tag) => tag === 'series' || tag === 'standalone')) return true
  return !tags.some((tag) => genres.has(tag))
}

interface ReportLine {
  row: MediaItem
  outcome: 'retagged' | 'cleared' | 'unchanged' | 'not-found' | 'google-unavailable' | 'error'
  detail: string
}

async function main() {
  if (!process.env.GOOGLE_BOOKS_API_KEY) throw new Error('GOOGLE_BOOKS_API_KEY is required')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  const allRows: MediaItem[] = await db.findMany(mediaItems, {
    where: { type: 'book', external_source: 'google-books' },
  })
  // Filtered here rather than in the query: the rule reads a jsonb array against
  // the genre table, which is code, not something to restate in SQL.
  const candidates = allRows.filter((row) => needsRetag(parseMediaMetadata(row.metadata).tags))
  const rows = LIMIT ? candidates.slice(0, LIMIT) : candidates

  console.log(
    `${candidates.length} of ${allRows.length} Google Books row(s) can't answer a genre` +
      `${LIMIT ? `, taking ${rows.length}` : ''}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`,
  )

  const lines: ReportLine[] = []

  await runBounded(rows, 5, async (row) => {
    const metadata = parseMediaMetadata(row.metadata)
    const before = metadata.tags

    try {
      await throttle()
      const detail = await getBookById(row.external_id)

      // Null is Google saying this volume is gone. Left as it is rather than
      // cleared: an absent volume is no evidence about the book.
      if (!detail) {
        lines.push({ row, outcome: 'not-found', detail: `${row.external_id} — no longer in Google Books` })
        return
      }

      const after = detail.tags
      const unchanged = before.length === after.length && before.every((tag, i) => tag === after[i])
      const outcome = unchanged ? 'unchanged' : after.length === 0 ? 'cleared' : 'retagged'
      lines.push({
        row,
        outcome,
        detail: `[${before.join(', ')}] -> [${after.join(', ')}]`,
      })

      if (APPLY && !unchanged) {
        await db.update(mediaItems, row.id, { metadata: { ...metadata, tags: after } })
      }
    } catch (error) {
      // The circuit in googleBooks.ts opens after three consecutive failures, so
      // a provider that goes down mid-run reports the rest of the rows this way
      // rather than hammering it. Re-running picks them up.
      const message = error instanceof Error ? error.message : String(error)
      const outcome = /not answering|failed: 4|failed: 5/.test(message) ? 'google-unavailable' : 'error'
      lines.push({ row, outcome, detail: message })
    }
  })

  for (const line of lines) {
    console.log(`[${line.outcome}] row ${line.row.id} "${line.row.title}" — ${line.detail}`)
  }

  const counts = lines.reduce<Record<string, number>>((acc, line) => {
    acc[line.outcome] = (acc[line.outcome] ?? 0) + 1
    return acc
  }, {})
  console.log('\nSummary:', counts)
  if (!APPLY) console.log('Dry run — nothing was written. Re-run with --apply to write these changes.')

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
