import type { Db } from '../db.ts'
import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import { logInteraction, normalizeRating } from '../mediaItems.ts'
import { headerIndex, parseCsv, runBounded } from './csv.ts'

interface RatingRow {
  title: string
  year: number | null
  // Null for a row with no score on it. Letterboxd's export leaves the Rating
  // cell blank rather than writing a 0, and a blank one is a film someone
  // watched without rating — not a film they gave nothing to.
  rating: number | null
  watchedAt: number
}

export interface LetterboxdImportResult {
  totalRows: number
  imported: number
  notFound: { title: string; year: number | null }[]
}

// The whole import runs inside the request, so this has to bound TMDB fan-out
// without making a few hundred ratings time out.
const CONCURRENCY = 8

// ratings.csv is the only file in Letterboxd's Data Export this needs, and
// asking for it directly avoids any zip handling.
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
      // An unrated row leaves an existing rating alone rather than clearing it:
      // a blank cell in an export is an absence of information, not an
      // instruction to forget what was rated here.
      rating: row.rating ?? undefined,
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

// Matched by header name, so column order doesn't break parsing.
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

    // `Number('')` is 0, and normalizeRating is what turns that back into
    // "unrated" rather than a zero-star review. The row is still a film they
    // watched, so only an unreadable date drops it.
    const rating = normalizeRating(Number(record[ratingIndex]))
    const watchedAt = Date.parse(record[dateIndex])
    if (Number.isNaN(watchedAt)) continue

    const year = yearIndex === -1 ? null : Number(record[yearIndex]) || null

    rows.push({ title: record[nameIndex], year, rating, watchedAt })
  }

  return rows
}

