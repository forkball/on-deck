// One-off backfill: re-points existing book media_items rows from Open
// Library onto Google Books, in place (same row id, so interactions stay
// attached), now that the book provider has switched (see
// app/data/catalog/provider.ts). Without this, re-searching an
// already-logged book creates a second row under the new source instead of
// finding the old one.
//
// Dry run by default — prints what it would do without writing anything.
// Pass --apply to actually update rows. Pass --limit=N to try it on a handful
// first, --max-requests=N to stop at a spend you choose, and --retry-settled to
// re-ask about rows a previous run already gave a verdict on.
//
// Every attempt is recorded in book_backfill_attempts, and a row with a settled
// verdict is left out of the next run. Without that, the rows this can't match
// keep external_source = 'openlibrary' and so stay in the set it selects: over
// half of them, measured, which made a second run spend most of its quota
// re-deriving failures it already knew. Google Books' quota is shared with the
// live app, so a wasted request here is one a person's search doesn't get.
//
// No stored ISBN exists on these rows to anchor a match, so this recovers
// one from Open Library's own edition data first and matches Google Books by
// ISBN rather than by title text — a bad title-only guess would silently
// overwrite a row's metadata (poster, description, page count) while a
// user's rating/notes stay attached to it. Rows that don't clear an ISBN and
// a title sanity check are left untouched rather than forced.
//
// Where no ISBN turns up, or the one that does leads to a different book, there
// is a second attempt by title and author — `intitle:`/`inauthor:`, which is a
// question precise enough to be worth asking (app/data/catalog/googleBooks.ts).
// It has to clear the title check *and* the author, since a title alone is what
// this refuses to match on. Open Library's ISBN is often an edition in another
// language: "La Mort heureuse" resolves to an ISBN for "A Happy Death", which
// fails the title check and leaves the row untouched though Google holds the
// French edition too.
//
// Pass --production to run it against production. That is the only way this
// reaches production: without it the connection is DATABASE_URL, so a run with a
// flag forgotten touches development rather than everyone's rows. Same reasoning
// as scripts/prod-query.ts, which reads PRODUCTION_DATABASE_URL and never
// DATABASE_URL — a script that touches production should say so rather than
// inherit whatever the ambient environment points at. `npm run
// prod:backfill-books` is that spelling, and the narrow capability the settings
// can allow.
//
// Deliberately its own pool rather than the app's (app/data/db.ts) — see
// db/migrate.ts for why.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { rematchMediaItem } from '../app/data/mediaItems.ts'
import {
  fieldedBookQuery,
  getBookById,
  plainBookQuery,
  searchGoogleBooksOnly,
} from '../app/data/catalog/googleBooks.ts'
import type { TmdbSearchResult as CatalogSearchResult } from '../app/data/catalog/tmdb.ts'
import { runBounded } from '../app/data/imports/csv.ts'
import { normalizeName, titleWordsFitInside, titlesNameSameWork } from '../app/data/titles.ts'
import { parseMediaMetadata } from '../app/data/mediaMetadata.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const APPLY = process.argv.includes('--apply')
const RETRY_SETTLED = process.argv.includes('--retry-settled')

function numericFlag(name: string): number | undefined {
  const arg = process.argv.find((candidate) => candidate.startsWith(`--${name}=`))
  return arg ? Number(arg.slice(name.length + 3)) : undefined
}

const LIMIT = numericFlag('limit')
// A ceiling on Google Books requests for this run, counted across both the
// search and the by-id lookup that applying a match costs. Rows are left for the
// next run rather than half-done: the budget is checked before a row starts.
const MAX_REQUESTS = numericFlag('max-requests')

const PRODUCTION = process.argv.includes('--production')
const CONNECTION = PRODUCTION ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL

const pool = new Pool({ connectionString: CONNECTION })
const db = createDatabase(createPostgresDatabaseAdapter(pool))

// Google Books' quota is 100 requests/minute/user — measured live, a plain
// run at concurrency 5 with no throttle blew through it and lost ~95 of 299
// rows to 429s. Sliding-window limiter shared across every worker, kept well
// under the cap since Open Library calls interleave with these too.
const GOOGLE_BOOKS_RATE_LIMIT = 80
const GOOGLE_BOOKS_RATE_WINDOW_MS = 60_000
const googleBooksCallTimes: number[] = []

async function throttleGoogleBooks(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (googleBooksCallTimes.length > 0 && now - googleBooksCallTimes[0] > GOOGLE_BOOKS_RATE_WINDOW_MS) {
      googleBooksCallTimes.shift()
    }
    if (googleBooksCallTimes.length < GOOGLE_BOOKS_RATE_LIMIT) {
      googleBooksCallTimes.push(now)
      return
    }
    await new Promise((resolve) =>
      setTimeout(resolve, GOOGLE_BOOKS_RATE_WINDOW_MS - (now - googleBooksCallTimes[0])),
    )
  }
}

// The budget, alongside the window above. The window keeps a run under Google's
// per-minute cap; this is what keeps one run from taking the whole day's quota,
// which the live app draws on too. Checked before a row starts rather than before
// each request, so a row in flight finishes rather than being left half-applied —
// a run can overshoot by the two requests one row costs.
let requestsSpent = 0

function budgetSpent(): boolean {
  return MAX_REQUESTS != null && requestsSpent >= MAX_REQUESTS
}

async function spendGoogleBooksRequest<T>(work: () => Promise<T>): Promise<T> {
  await throttleGoogleBooks()
  requestsSpent++
  return work()
}

// An empty `items` from Google Books is not reliably an answer: measured twice in
// twenty searches, with the same query returning results moments later. Now that a
// verdict is recorded and honoured, believing the first empty response writes the
// row off for good — so it is asked a second time before that.
const EMPTY_RETRY_DELAY_MS = 1_000

async function searchGoogleBooksTwice(query: string): Promise<CatalogSearchResult[]> {
  const first = await spendGoogleBooksRequest(() => searchGoogleBooksOnly(query))
  if (first.length > 0) return first

  await new Promise((resolve) => setTimeout(resolve, EMPTY_RETRY_DELAY_MS))
  return spendGoogleBooksRequest(() => searchGoogleBooksOnly(query))
}

// A query whose answer is not in doubt, asked before an empty result is believed.
//
// Google Books answers a query it will not serve with HTTP 200 and `totalItems: 0`,
// which at the point we read it is indistinguishable from "no such book" — nothing
// throws, so neither fetchWithRetry nor the retry above does anything about it. On
// 2026-10-01 a run recorded 29 of 30 rows as "no Google Books hit" that way, and every
// one of those ISBNs had matched two days earlier. The cause turned out to be that
// `isbn:`, `intitle:` and `inauthor:` had all begun answering 0 while unqualified text
// kept working. Because the verdict is settled, those 29 rows would have been skipped
// by every future run: 5% of the job written off over a provider's bad week.
//
// So "no hit" now has to be a fact about the catalogue rather than about the day. If
// the canary comes back empty too, the whole run stops: a provider that cannot answer
// this cannot answer anything, and every verdict after it would be fiction.
// Deliberately unqualified. It was intitle:"dune" for a day, which is a canary that
// cannot survive the thing it watches for: on 2026-10-02 every field-qualified query
// began answering 0 while plain text kept working, so the canary would have aborted
// every run while the catalogue was perfectly able to answer.
const CANARY_QUERY = 'dune'

// How long a passing canary stands for. Not once per run: a run of 500 rows takes
// twenty minutes, and an outage starting in the middle of one would poison every
// verdict after it while an answer from minute one vouched for them.
const CANARY_GOOD_FOR_MS = 30_000

let canaryCheckedAt = 0
let abortReason: string | null = null

// Whether `isbn:`, `intitle:` and `inauthor:` are answering at all today, asked once.
//
// They are the precise way to ask, and when they work the ISBN alone settles most
// rows in one request. When they don't, every one of them is a request spent to be
// told nothing — measured at 5.5 requests per row against 1.6, which over 549 rows is
// most of a day's quota burnt on queries already known to be dead. So they are tried
// once, and dropped for the rest of the run if that one comes back empty.
const QUALIFIED_CANARY = 'intitle:"dune"'

let qualifiersAnswer: boolean | null = null

async function qualifiersWork(): Promise<boolean> {
  if (qualifiersAnswer == null) {
    const probe = await spendGoogleBooksRequest(() => searchGoogleBooksOnly(QUALIFIED_CANARY))
    qualifiersAnswer = probe.length > 0
    if (!qualifiersAnswer) {
      console.log(
        `Google Books answered ${JSON.stringify(QUALIFIED_CANARY)} with nothing while plain ` +
          'text still works, so the field qualifiers are not answering. Asking by ISBN is ' +
          'skipped for this run; rows are settled on title and author instead.',
      )
    }
  }
  return qualifiersAnswer
}

async function believesEmptyResults(): Promise<boolean> {
  if (abortReason != null) return false
  if (Date.now() - canaryCheckedAt < CANARY_GOOD_FOR_MS) return true

  const canary = await spendGoogleBooksRequest(() => searchGoogleBooksOnly(CANARY_QUERY))
  if (canary.length > 0) {
    canaryCheckedAt = Date.now()
    return true
  }

  abortReason =
    `Google Books answered ${JSON.stringify(CANARY_QUERY)} with nothing, so it is not ` +
    'answering at all. Stopping rather than recording verdicts that would take an outage ' +
    'to justify. Google reports this as an empty result rather than an error, so there is ' +
    'nothing in the response to read — try the same query in a browser to see whether it ' +
    'is the catalogue or us.'
  return false
}

const OPEN_LIBRARY_BASE = 'https://openlibrary.org'
const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status < 500) return response
      lastError = new Error(`Open Library responded ${response.status}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < FETCH_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
  }
  throw lastError instanceof Error ? lastError : new Error('Open Library request failed')
}

interface OpenLibraryEdition {
  isbn_13?: string[]
  isbn_10?: string[]
  languages?: { key: string }[]
}

interface OpenLibraryEditionsResponse {
  entries?: OpenLibraryEdition[]
}

// Editions aren't returned in any preference order — for a widely-translated
// work, the first one with an ISBN is as likely to be French or Turkish as
// English (measured live on "The Colour of Magic": the very first entry was
// a French edition mislabeled with an English-looking title, which is what
// title-mismatched it against Google's — correctly — French listing). An
// English-tagged edition is worth a second pass to find rather than taking
// whatever comes first, since a stored title is effectively always English
// here (this app has no per-item source-language field to check instead).
function pickIsbn(edition: OpenLibraryEdition): string | null {
  return edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? null
}

async function findIsbnForWork(workExternalId: string): Promise<string | null> {
  const url = new URL(`${OPEN_LIBRARY_BASE}/works/${workExternalId}/editions.json`)
  url.searchParams.set('limit', '50')

  const response = await fetchWithRetry(url)
  if (!response.ok) return null

  const data = (await response.json()) as OpenLibraryEditionsResponse
  const entries = data.entries ?? []

  for (const edition of entries) {
    if (edition.languages?.some((lang) => lang.key === '/languages/eng')) {
      const isbn = pickIsbn(edition)
      if (isbn) return isbn
    }
  }

  // No English-tagged edition carried an ISBN — fall back to the first one
  // that has any, same as before. titlesNameSameWork still gates the result,
  // so a foreign match here gets caught rather than written.
  for (const edition of entries) {
    const isbn = pickIsbn(edition)
    if (isbn) return isbn
  }

  return null
}

interface Row {
  id: number
  external_id: string
  title: string
  metadata: unknown
}

type Outcome =
  | 'matched'
  | 'matched-by-title'
  | 'isbn-not-asked'
  | 'no-isbn'
  | 'no-google-hit'
  | 'google-unavailable'
  | 'title-mismatch'
  | 'error'

interface ReportLine {
  row: Row
  outcome: Outcome
  detail: string
  // Whether the volume this row is being moved onto carries the two fields the
  // move is for. Without an overview there is nothing to verify a recommendation
  // against and the local-catalog shortcut skips the row anyway, so a match with
  // none of its own has changed the source and fixed nothing. Counted in the dry
  // run so the decision to spend the quota can be made on it.
  gains?: string
}

// A verdict asking again would only re-derive. The ones left out are about Google or
// about us, not about the book: 'google-unavailable' means Google didn't answer, and
// a re-run is what turns it into an answer. 'isbn-not-asked' is the same thing in
// slower motion — the row has an ISBN and that ISBN is the best question there is, so
// a run that couldn't ask it has not learned anything about the row worth keeping.
const SETTLED: ReadonlySet<Outcome> = new Set([
  'matched',
  'matched-by-title',
  'no-isbn',
  'no-google-hit',
  'title-mismatch',
])

// Only ever written under --apply. A dry run is defined by writing nothing, and a
// recorded 'matched' from a dry run would take the row out of the run that applies it.
async function recordAttempt(line: ReportLine): Promise<void> {
  await pool.query(
    `insert into book_backfill_attempts (media_item_id, outcome, detail, attempted_at)
     values ($1,$2,$3,$4)
     on conflict (media_item_id) do update
        set outcome = excluded.outcome, detail = excluded.detail, attempted_at = excluded.attempted_at`,
    [line.row.id, line.outcome, line.detail, Date.now()],
  )
}

// Whether a candidate is the row's book. The titles agreeing on their own is enough;
// short of that the author has to agree too, which is what separates a subtitle from
// a sequel — "Dune" fits inside "Dune: House Harkonnen" as neatly as "The Goldfinch"
// fits inside "The Goldfinch: A Novel", and only the author says which is which.
//
// The same rule the recommendation pipeline settled on for books in #177: a reprint
// changes the year, the subtitle and the cover, and not who wrote it.
function isSameBook(row: Row, candidate: CatalogSearchResult): boolean {
  if (titlesNameSameWork(row.title, candidate.title)) return true

  const stored = normalizeName(parseMediaMetadata(row.metadata).creator)
  const found = normalizeName(candidate.creator)
  if (!stored || !found || stored !== found) return false

  // One direction only. The row's title fitting inside the candidate's is a subtitle
  // Google spells out — "The Goldfinch" filed as "The Goldfinch: A Novel". The reverse
  // is a candidate *less* specific than the row, which is a different book every time:
  // "House Corrino: Dune" matched plain "Dune" this way, 696 pages of the wrong novel,
  // with the author agreeing because the series shares one.
  return titleWordsFitInside(row.title, candidate.title)
}

// Which of several passing candidates to take. `find` took the first, and Google's
// first is not the best: "Dune House Corrino" landed on "Dune: House Corrino Vol. 3",
// a 117-page comic adaptation, while the novel sat further down the same results.
//
// A title that agrees outright beats one that merely contains the row's, and then
// length breaks the tie — an adaptation or an abridgement is short, and the row being
// repointed is the full work.
function bestOf(row: Row, candidates: CatalogSearchResult[]): CatalogSearchResult | null {
  const passing = candidates.filter((candidate) => isSameBook(row, candidate))
  if (passing.length === 0) return null

  return passing.sort((a, b) => {
    const exact = (candidate: CatalogSearchResult) => (titlesNameSameWork(row.title, candidate.title) ? 0 : 1)
    const described = (candidate: CatalogSearchResult) => (candidate.overview ? 0 : 1)
    return exact(a) - exact(b) || described(a) - described(b) || (b.pageCount ?? 0) - (a.pageCount ?? 0)
  })[0]!
}

// The second attempt, for a row an ISBN couldn't place. Accepted only when the
// author agrees as well as the title: a title on its own is exactly what this
// script refuses to repoint a row on, and the author is the one thing a reprint
// or a translation doesn't change.
async function findByTitleAndAuthor(row: Row): Promise<CatalogSearchResult | null> {
  const creator = parseMediaMetadata(row.metadata).creator
  if (!creator) return null

  // Qualified first, then plain, exactly as searchBooks does — and for a reason it
  // learned the hard way. When the qualifiers went dead this was the whole second
  // attempt, so a row the ISBN could not place had nowhere left to go. Plain text is
  // safe here because the verdict is not the query's to give: isSameBook has to agree
  // on the title and normalizeName on the author before anything is repointed.
  const asked = normalizeName(creator)
  const plain = plainBookQuery({ title: row.title, creator })
  const fielded = fieldedBookQuery({ title: row.title, creator })

  let candidates = fielded == null || !(await qualifiersWork()) ? [] : await searchGoogleBooksTwice(fielded)
  if (candidates.length === 0) candidates = await searchGoogleBooksTwice(plain)

  return bestOf(
    row,
    candidates.filter((candidate) => normalizeName(candidate.creator) === asked),
  )
}

async function main() {
  if (!process.env.GOOGLE_BOOKS_API_KEY) throw new Error('GOOGLE_BOOKS_API_KEY is required')
  if (!CONNECTION) {
    throw new Error(PRODUCTION ? 'PRODUCTION_DATABASE_URL is required' : 'DATABASE_URL is required')
  }

  // Raw SQL rather than db.findMany for the one thing findMany can't express: the
  // rows a previous run has already settled, which are the whole point of the table.
  const { rows: allRows } = await pool.query<Row>(
    `select m.id, m.external_id, m.title, m.metadata
       from media_items m
       left join book_backfill_attempts a on a.media_item_id = m.id
      where m.type = 'book'
        and m.external_source = 'openlibrary'
        ${RETRY_SETTLED ? '' : `and (a.outcome is null or a.outcome not in (${[...SETTLED].map((o) => `'${o}'`).join(',')}))`}
      order by m.id`,
  )
  const rows = LIMIT ? allRows.slice(0, LIMIT) : allRows

  const {
    rows: [settled],
  } = await pool.query<{ count: number }>(
    `select count(*)::int as count from book_backfill_attempts a
       join media_items m on m.id = a.media_item_id
      where m.external_source = 'openlibrary' and a.outcome = any($1)`,
    [[...SETTLED]],
  )

  console.log(
    `${rows.length} Open Library book row(s) to try. ` +
      `Database: ${PRODUCTION ? 'PRODUCTION' : 'development'}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}` +
      `${MAX_REQUESTS == null ? '' : `, budget ${MAX_REQUESTS} Google Books request(s)`}` +
      `${settled && settled.count > 0 ? `. ${settled.count} already settled and skipped${RETRY_SETTLED ? ' — no, re-asked, --retry-settled is set' : ''}` : ''}`,
  )

  const lines: ReportLine[] = []
  let skippedForBudget = 0

  const report = async (row: Row, outcome: Outcome, detail: string, found?: CatalogSearchResult) => {
    const gains = found
      ? `overview ${found.overview ? 'yes' : 'no'}, ${found.pageCount ?? 'no'} page(s)`
      : undefined
    lines.push({ row, outcome, detail, gains })
    if (APPLY) await recordAttempt({ row, outcome, detail })
  }

  // Per-row, not per-batch: Google Books and Open Library both wobble
  // (measured live 503s from both), and one row's failure shouldn't lose the
  // report for every other row already resolved by the time it happens.
  await runBounded(rows, 5, async (row) => {
    if (abortReason != null) return
    if (budgetSpent()) {
      skippedForBudget++
      return
    }

    try {
      const isbn = await findIsbnForWork(row.external_id)

      // Google Books only, never searchBooks: that one falls back to Open
      // Library, which would answer with the source this row is being moved off
      // and report it as a match. fetchWithRetry has already spent its attempts
      // by the time this throws, so a throw here means Google would not answer,
      // which is a row to leave alone rather than resolve some other way.
      let candidate: CatalogSearchResult | null = null
      let how: 'matched' | 'matched-by-title' = 'matched'
      let missed: Outcome = isbn ? 'isbn-not-asked' : 'no-isbn'
      let detail = isbn
        ? `ISBN ${isbn} not asked — Google Books is not answering qualified queries`
        : 'no ISBN on any Open Library edition'

      try {
        if (isbn && (await qualifiersWork())) {
          const [first] = await searchGoogleBooksTwice(`isbn:${isbn}`)
          if (!first) {
            if (!(await believesEmptyResults())) return
            missed = 'no-google-hit'
            detail = `ISBN ${isbn} — no Google Books hit`
          } else if (!isSameBook(row, first)) {
            missed = 'title-mismatch'
            detail = `ISBN ${isbn} matched "${first.title}", too different from "${row.title}"`
          } else {
            candidate = first
            detail = `ISBN ${isbn} -> ${first.externalId} "${first.title}"`
          }
        }

        // Whatever the ISBN did or didn't settle, the title and author are still
        // worth one question — see the note at the top of the file.
        if (!candidate) {
          const found = await findByTitleAndAuthor(row)
          if (!found && !(await believesEmptyResults())) return
          if (found) {
            candidate = found
            how = 'matched-by-title'
            detail = `title and author -> ${found.externalId} "${found.title}" (${detail})`
          }
        }
      } catch (error) {
        await report(
          row,
          'google-unavailable',
          // Kept apart from no-google-hit: one means Google says this book does
          // not exist, the other means Google did not answer. Only the first is
          // a fact about the catalogue, and a re-run turns the second into one.
          `Google Books did not answer: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }

      if (!candidate) {
        await report(row, missed, detail)
        return
      }

      await report(row, how, detail, candidate)

      if (APPLY) {
        const result = await rematchMediaItem(
          db,
          'book',
          row.id,
          candidate.externalId,
          (externalId) => spendGoogleBooksRequest(() => getBookById(externalId)),
          'google-books',
          'Google Books lookup failed during backfill.',
        )
        if (!result.ok) {
          console.error(`  ! row ${row.id} ("${row.title}") failed to apply: ${result.error}`)
        }
      }
    } catch (error) {
      await report(row, 'error', error instanceof Error ? error.message : String(error))
    }
  })

  for (const line of lines) {
    console.log(
      `[${line.outcome}] row ${line.row.id} "${line.row.title}" — ${line.detail}` +
        `${line.gains ? ` [${line.gains}]` : ''}`,
    )
  }

  const counts = lines.reduce<Record<string, number>>((acc, line) => {
    acc[line.outcome] = (acc[line.outcome] ?? 0) + 1
    return acc
  }, {})
  console.log('\nSummary:', counts)

  // The number the whole job is for. 498 of the 549 Open Library book rows carry no
  // overview, against 179 of 283 Google Books ones — so a matched row that gains one
  // is a row a recommendation can be verified against and the local catalog can
  // answer for. A match that gains nothing has moved the source and nothing else.
  const matches = lines.filter((line) => line.gains)
  const withOverview = matches.filter((line) => line.gains?.includes('overview yes')).length
  console.log(`${withOverview} of ${matches.length} match(es) bring an overview`)
  console.log(`Google Books requests spent: ${requestsSpent}`)
  if (skippedForBudget > 0) {
    console.log(`${skippedForBudget} row(s) left for the next run — the budget ran out.`)
  }
  if (abortReason != null) {
    console.error(`\nStopped: ${abortReason}`)
    console.error('Rows reached after that point were left untouched and unrecorded.')
    process.exitCode = 1
  }
  if (!APPLY) {
    console.log('Dry run — nothing was written, and no attempt was recorded. Re-run with --apply.')
  }

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
