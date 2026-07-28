import AdmZip from 'adm-zip'

import type { Db } from './db.ts'
import { logInteraction, upsertMovie } from './movies.ts'
import { searchMovies, type TmdbSearchResult } from './tmdb.ts'

interface RatingRow {
  title: string
  year: number | null
  rating: number
  watchedAt: number
}

export interface LetterboxdImportResult {
  totalRows: number
  imported: number
  notFound: { title: string; year: number | null }[]
}

// Bounded so we don't fire hundreds of concurrent TMDB requests at once, but
// high enough that a few hundred ratings still finish in one request — this
// app has no background job queue, so the whole import runs synchronously.
const CONCURRENCY = 8

// Extracts and imports ratings.csv from a Letterboxd export zip. Everything
// else in the export (diary, reviews, watchlist, lists, comments, likes) is
// ignored — ratings are the only thing asked for.
export async function importLetterboxdRatings(
  db: Db,
  userId: number,
  zipBuffer: Buffer,
): Promise<LetterboxdImportResult> {
  const zip = new AdmZip(zipBuffer)
  const entry = zip.getEntry('ratings.csv')
  if (!entry) {
    throw new Error('This doesn\'t look like a Letterboxd export — no ratings.csv found in the zip.')
  }

  const rows = parseRatingsCsv(entry.getData().toString('utf-8'))
  const notFound: LetterboxdImportResult['notFound'] = []
  let imported = 0
  let nextIndex = 0

  async function worker() {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++]
      const match = await matchMovie(row.title, row.year)
      if (!match) {
        notFound.push({ title: row.title, year: row.year })
        continue
      }

      const item = await upsertMovie(db, match)
      await logInteraction(db, userId, item.id, {
        status: 'consumed',
        rating: row.rating,
        notes: null,
        consumedAt: row.watchedAt,
      })
      imported++
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))

  return { totalRows: rows.length, imported, notFound }
}

async function matchMovie(title: string, year: number | null): Promise<TmdbSearchResult | null> {
  const matches = await searchMovies(title)
  if (matches.length === 0) return null
  if (year == null) return matches[0]

  return (
    matches.find((m) => m.releaseYear === year) ??
    [...matches].sort(
      (a, b) => Math.abs((a.releaseYear ?? 0) - year) - Math.abs((b.releaseYear ?? 0) - year),
    )[0]
  )
}

// Letterboxd's ratings.csv columns: Date, Name, Year, Letterboxd URI, Rating
// — matched by header name (not position) so column order/extra columns
// don't break parsing.
function parseRatingsCsv(text: string): RatingRow[] {
  const table = parseCsv(text)
  if (table.length === 0) return []

  const header = table[0].map((column) => column.trim().toLowerCase())
  const dateIndex = header.indexOf('date')
  const nameIndex = header.indexOf('name')
  const yearIndex = header.indexOf('year')
  const ratingIndex = header.indexOf('rating')

  if (dateIndex === -1 || nameIndex === -1 || ratingIndex === -1) {
    throw new Error('ratings.csv is missing expected columns (Date, Name, Rating).')
  }

  const rows: RatingRow[] = []
  for (const record of table.slice(1)) {
    if (record.length === 0 || (record.length === 1 && record[0] === '')) continue

    const rating = Number(record[ratingIndex])
    const watchedAt = Date.parse(record[dateIndex])
    if (!Number.isFinite(rating) || Number.isNaN(watchedAt)) continue

    const year = yearIndex === -1 ? null : Number(record[yearIndex]) || null

    rows.push({ title: record[nameIndex], year, rating, watchedAt })
  }

  return rows
}

// Minimal RFC 4180 CSV parser — handles quoted fields (including embedded
// commas and escaped "" quotes), which Letterboxd uses for any title
// containing a comma (e.g. "Synecdoche, New York").
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // skip
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
