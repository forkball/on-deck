import { headerIndex, parseCsv } from './csv.ts'
import { normalizeRating } from '../mediaItems.ts'
import type { ParsedRow } from './batches.ts'

// ratings.csv is the only file in Letterboxd's Data Export this needs, and
// asking for it directly avoids any zip handling.
//
// Parsing is all this does now. Matching moved to app/data/imports/matcher.ts,
// behind a staged batch, so a wrong match can be seen and corrected before it
// reaches anyone's log — see the 20260818120000 migration.
export function parseLetterboxdRatings(csvText: string): ParsedRow[] {
  const table = parseCsv(csvText)
  if (table.length === 0) return []

  const indexOf = headerIndex(table[0])
  const dateIndex = indexOf('date')
  const nameIndex = indexOf('name')
  const yearIndex = indexOf('year')
  const ratingIndex = indexOf('rating')

  if (dateIndex === -1 || nameIndex === -1 || ratingIndex === -1) {
    throw new Error('ratings.csv is missing expected columns (Date, Name, Rating).')
  }

  const rows: ParsedRow[] = []

  for (const [offset, record] of table.slice(1).entries()) {
    if (record.length === 0 || (record.length === 1 && record[0] === '')) continue

    // `Number('')` is 0, and normalizeRating is what turns that back into
    // "unrated" rather than a zero-star review. The row is still a film they
    // watched, so only an unreadable date drops it.
    const rating = normalizeRating(Number(record[ratingIndex]))
    const watchedAt = Date.parse(record[dateIndex])
    if (Number.isNaN(watchedAt)) continue

    const year = yearIndex === -1 ? null : Number(record[yearIndex]) || null

    rows.push({
      // The line in the uploaded file, counting the header — this is what the
      // review page calls the row, so it has to match what someone sees when
      // they open the CSV themselves.
      rowIndex: offset + 2,
      title: record[nameIndex],
      year,
      rating,
      // Letterboxd's ratings export carries neither, so there is nothing to
      // overwrite a note or a dislike with.
      disliked: null,
      notes: null,
      consumedAt: watchedAt,
    })
  }

  return rows
}
