import type { Db } from './db.ts'
import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from './catalog.ts'
import { logInteraction } from './mediaCatalog.ts'
import { headerIndex, parseCsv, runBounded } from './csvImport.ts'

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

// Imports a Letterboxd ratings.csv (the one file inside the Data Export zip
// this cares about — asking for just that file directly means no zip
// handling at all, and users don't need us to explain what we ignore).
export async function importLetterboxdRatings(
  db: Db,
  userId: number,
  csvText: string,
): Promise<LetterboxdImportResult> {
  const rows = parseRatingsCsv(csvText)
  const notFound: LetterboxdImportResult['notFound'] = []
  let imported = 0

  await runBounded(rows, CONCURRENCY, async (row) => {
    const match = await matchMovie(row.title, row.year)
    if (!match) {
      notFound.push({ title: row.title, year: row.year })
      return
    }

    const item = await upsertCatalogItem(db, 'movie', match)
    await logInteraction(db, userId, item.id, {
      status: 'consumed',
      rating: row.rating,
      notes: null,
      consumedAt: row.watchedAt,
    })
    imported++
  })

  return { totalRows: rows.length, imported, notFound }
}

async function matchMovie(title: string, year: number | null): Promise<CatalogSearchResult | null> {
  const matches = await getCatalogProvider('movie').search(title)
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

  const indexOf = headerIndex(table[0])
  const dateIndex = indexOf('date')
  const nameIndex = indexOf('name')
  const yearIndex = indexOf('year')
  const ratingIndex = indexOf('rating')

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

