import { cleanCell, headerIndex, parseCsv } from './csv.ts'
import { normalizeRating } from '../mediaItems.ts'
import type { ParsedRow } from './batches.ts'
import type { LogInteractionInput } from '../mediaItems.ts'

const SHELF_STATUS: Record<string, LogInteractionInput['status']> = {
  read: 'consumed',
  'currently-reading': 'in_progress',
  'to-read': 'want_to_consume',
}

export function parseGoodreadsLibrary(csvText: string): ParsedRow[] {
  const table = parseCsv(csvText)
  if (table.length === 0) return []

  const indexOf = headerIndex(table[0])
  const titleIndex = indexOf('title')
  const shelfIndex = indexOf('exclusive shelf')
  if (titleIndex === -1 || shelfIndex === -1) {
    throw new Error('That doesn\'t look like a Goodreads export — expected "Title" and "Exclusive Shelf" columns.')
  }

  const authorIndex = indexOf('author')
  const isbn13Index = indexOf('isbn13')
  const isbnIndex = indexOf('isbn')
  const ratingIndex = indexOf('my rating')
  const readIndex = indexOf('date read')
  const reviewIndex = indexOf('my review')
  // The original identifies the work; the edition's year is just a printing.
  const originalYearIndex = indexOf('original publication year')
  const editionYearIndex = indexOf('year published')

  const rows: ParsedRow[] = []

  for (const [offset, record] of table.slice(1).entries()) {
    if (record.length === 0 || (record.length === 1 && record[0] === '')) continue

    const title = cleanCell(record[titleIndex])
    const logStatus = SHELF_STATUS[cleanCell(record[shelfIndex]).toLowerCase()]
    // An unknown shelf is dropped rather than guessed at.
    if (!title || !logStatus) continue

    const readAt = Date.parse(cleanCell(record[readIndex]))

    rows.push({
      // Line in the file, counting the header — the review page cites it.
      rowIndex: offset + 2,
      title,
      year: readYear(record, originalYearIndex) ?? readYear(record, editionYearIndex),
      // 0 means unrated, not a zero-star review.
      rating: normalizeRating(Number(cleanCell(record[ratingIndex]))),
      disliked: null,
      notes: cleanCell(record[reviewIndex]) || null,
      consumedAt: Number.isNaN(readAt) ? null : readAt,
      logStatus,
      author: cleanCell(record[authorIndex]) || null,
      isbn: normalizeIsbn(cleanCell(record[isbn13Index]) || cleanCell(record[isbnIndex])),
    })
  }

  return rows
}

function readYear(record: string[], index: number): number | null {
  if (index === -1) return null
  return Number(cleanCell(record[index])) || null
}

// Digits plus the X that can end a 10-digit ISBN; hyphenated forms arrive too.
function normalizeIsbn(raw: string): string | null {
  const normalized = raw.replace(/[^0-9Xx]/g, '').toUpperCase()
  return normalized === '' ? null : normalized
}
