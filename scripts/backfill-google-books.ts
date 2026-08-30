// One-off backfill: re-points existing book media_items rows from Open
// Library onto Google Books, in place (same row id, so interactions stay
// attached), now that the book provider has switched (see
// app/data/catalog/provider.ts). Without this, re-searching an
// already-logged book creates a second row under the new source instead of
// finding the old one.
//
// Dry run by default — prints what it would do without writing anything.
// Pass --apply to actually update rows. Pass --limit N to try it on a
// handful first.
//
// No stored ISBN exists on these rows to anchor a match, so this recovers
// one from Open Library's own edition data first and matches Google Books by
// ISBN rather than by title text — a bad title-only guess would silently
// overwrite a row's metadata (poster, description, page count) while a
// user's rating/notes stay attached to it. Rows that don't clear an ISBN and
// a title sanity check are left untouched rather than forced.
//
// Deliberately its own pool rather than the app's (app/data/db.ts) — see
// db/migrate.ts for why.

import { Pool, types } from 'pg'

import { createDatabase } from 'remix/data-table'
import { createPostgresDatabaseAdapter } from 'remix/data-table/postgres'

import { mediaItems, type MediaItem } from '../app/data/schema.ts'
import { rematchMediaItem } from '../app/data/mediaItems.ts'
import { getBookById, searchGoogleBooksOnly } from '../app/data/catalog/googleBooks.ts'
import type { TmdbSearchResult as CatalogSearchResult } from '../app/data/catalog/tmdb.ts'
import { runBounded } from '../app/data/imports/csv.ts'

types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10))
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value))

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
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
    await new Promise((resolve) => setTimeout(resolve, GOOGLE_BOOKS_RATE_WINDOW_MS - (now - googleBooksCallTimes[0])))
  }
}

// Same title-similarity check app/data/recommendations/matching.ts uses,
// copied rather than imported — that module pulls in the app's live db pool
// and the Claude client at import time, neither of which this script wants.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

const TITLE_SIMILARITY_THRESHOLD = 0.5

// Google's book titles often carry a marketing subtitle Open Library's don't
// ("Night Shift" vs "Night Shift: INCLUDES THE STORY OF 'THE BOOGEYMAN'...")
// — stripped at the first colon before falling back to Levenshtein, same as
// matching.ts's withoutSubtitle. Missing this dropped 51 of 93 mismatches in
// an earlier dry run down to a formatting difference, not a wrong book.
function withoutSubtitle(title: string): string {
  const [main] = title.split(/\s*[:–—]\s*/)
  return normalizeTitle(main ?? title)
}

function titlesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na === withoutSubtitle(b) || withoutSubtitle(a) === nb) return true
  const distance = levenshteinDistance(na, nb)
  return 1 - distance / Math.max(na.length, nb.length) >= TITLE_SIMILARITY_THRESHOLD
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
  // that has any, same as before. titlesLikelyMatch still gates the result,
  // so a foreign match here gets caught rather than written.
  for (const edition of entries) {
    const isbn = pickIsbn(edition)
    if (isbn) return isbn
  }

  return null
}

type Row = MediaItem

interface ReportLine {
  row: Row
  outcome: 'matched' | 'no-isbn' | 'no-google-hit' | 'google-unavailable' | 'title-mismatch' | 'error'
  detail: string
}

async function main() {
  if (!process.env.GOOGLE_BOOKS_API_KEY) throw new Error('GOOGLE_BOOKS_API_KEY is required')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  const allRows: Row[] = await db.findMany(mediaItems, {
    where: { type: 'book', external_source: 'openlibrary' },
  })
  const rows = LIMIT ? allRows.slice(0, LIMIT) : allRows

  console.log(`${rows.length} Open Library book row(s). Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)

  const lines: ReportLine[] = []

  // Per-row, not per-batch: Google Books and Open Library both wobble
  // (measured live 503s from both), and one row's failure shouldn't lose the
  // report for every other row already resolved by the time it happens.
  await runBounded(rows, 5, async (row) => {
    try {
      const isbn = await findIsbnForWork(row.external_id)
      if (!isbn) {
        lines.push({ row, outcome: 'no-isbn', detail: 'no ISBN on any Open Library edition' })
        return
      }

      await throttleGoogleBooks()
      // Google Books only, never searchBooks: that one falls back to Open
      // Library, which would answer with the source this row is being moved off
      // and report it as a match. fetchWithRetry has already spent its attempts
      // by the time this throws, so a throw here means Google would not answer,
      // which is a row to leave alone rather than resolve some other way.
      let candidates: CatalogSearchResult[]
      try {
        candidates = await searchGoogleBooksOnly(`isbn:${isbn}`)
      } catch (error) {
        lines.push({
          row,
          outcome: 'google-unavailable',
          // Kept apart from no-google-hit: one means Google says this book does
          // not exist, the other means Google did not answer. Only the first is
          // a fact about the catalogue, and a re-run turns the second into one.
          detail: `ISBN ${isbn} — Google Books did not answer: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }

      const candidate = candidates[0]
      if (!candidate) {
        lines.push({ row, outcome: 'no-google-hit', detail: `ISBN ${isbn} — no Google Books hit` })
        return
      }

      if (!titlesLikelyMatch(row.title, candidate.title)) {
        lines.push({
          row,
          outcome: 'title-mismatch',
          detail: `ISBN ${isbn} matched "${candidate.title}", too different from "${row.title}"`,
        })
        return
      }

      lines.push({ row, outcome: 'matched', detail: `ISBN ${isbn} -> ${candidate.externalId} "${candidate.title}"` })

      if (APPLY) {
        const result = await rematchMediaItem(
          db,
          'book',
          row.id,
          candidate.externalId,
          async (externalId) => {
            await throttleGoogleBooks()
            return getBookById(externalId)
          },
          'google-books',
          'Google Books lookup failed during backfill.',
        )
        if (!result.ok) {
          console.error(`  ! row ${row.id} ("${row.title}") failed to apply: ${result.error}`)
        }
      }
    } catch (error) {
      lines.push({ row, outcome: 'error', detail: error instanceof Error ? error.message : String(error) })
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
