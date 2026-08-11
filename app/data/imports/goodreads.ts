import type { CatalogSearchResult } from '../catalog/provider.ts'
import { cleanCell, headerIndex, parseCsv, runBounded } from './csv.ts'
import type { Db } from '../db.ts'
import { logInteraction, upsertMediaItem, type LogInteractionInput } from '../mediaItems.ts'
import { getBooksByIsbns, normalizeIsbn, searchBooks } from '../catalog/openLibrary.ts'

// Pinned to Open Library rather than routed through the book provider
// registry (which is Google Books): the ISBN batch resolution below only
// Open Library supports, so the whole import stays on one provider rather
// than mixing sources — and tagging a row 'google-books' with an Open
// Library-shaped id would break any later rematch against it.
const SOURCE = 'openlibrary'

export interface GoodreadsImportResult {
  totalRows: number
  imported: number
  // Rows whose book couldn't be found in the catalog at all.
  notFound: { title: string; author: string }[]
  // Surfaced because title/author guesses are where wrong matches come from.
  matchedByIsbn: number
  matchedByTitle: number
}

// Goodreads' three shelves map exactly onto the app's three statuses, unlike
// Letterboxd's export, which can only produce "watched".
const SHELF_STATUS: Record<string, LogInteractionInput['status']> = {
  read: 'consumed',
  'currently-reading': 'in_progress',
  'to-read': 'want_to_consume',
}

// Only really governs the fallback: the ISBN path resolves 20 per request.
const CONCURRENCY = 8

interface ShelfRow {
  title: string
  author: string
  isbn: string
  status: LogInteractionInput['status']
  rating: number | null
  notes: string | null
  readAt: number | null
}

// Goodreads retired its public API in 2020, so the CSV export is the only way
// in — but it carries ISBNs, so most rows resolve to an exact edition.
export async function importGoodreadsLibrary(
  db: Db,
  userId: number,
  csvText: string,
): Promise<GoodreadsImportResult> {
  const rows = parseShelfCsv(csvText)
  const notFound: GoodreadsImportResult['notFound'] = []
  let imported = 0
  let matchedByIsbn = 0
  let matchedByTitle = 0

  // 20 per request instead of one per book — seconds rather than minutes on a
  // real library.
  const byIsbn = await getBooksByIsbns(rows.map((row) => row.isbn).filter(Boolean))

  const needsFallback: ShelfRow[] = []
  const resolved: { row: ShelfRow; match: CatalogSearchResult }[] = []

  for (const row of rows) {
    const match = row.isbn ? byIsbn.get(normalizeIsbn(row.isbn)) : undefined
    if (match) {
      resolved.push({ row, match })
      matchedByIsbn++
    } else {
      needsFallback.push(row)
    }
  }

  await runBounded(needsFallback, CONCURRENCY, async (row) => {
    const match = await matchByTitle(row.title, row.author)
    if (!match) {
      notFound.push({ title: row.title, author: row.author })
      return
    }
    resolved.push({ row, match })
    matchedByTitle++
  })

  await runBounded(resolved, CONCURRENCY, async ({ row, match }) => {
    const item = await upsertMediaItem(db, 'book', match, SOURCE)
    await logInteraction(db, userId, item.id, {
      status: row.status,
      // Goodreads writes 0 for an unrated book, already folded to null on the
      // way in. Omitted rather than passed through, so re-importing a shelf
      // can't clear a rating given here after the export was taken.
      rating: row.rating ?? undefined,
      notes: row.notes,
      // Only "read" rows carry a date.
      consumedAt: row.readAt ?? undefined,
    })
    imported++
  })

  return { totalRows: rows.length, imported, notFound, matchedByIsbn, matchedByTitle }
}

async function matchByTitle(title: string, author: string): Promise<CatalogSearchResult | null> {
  const query = author ? `${title} ${author}` : title
  const matches = await searchBooks(query)
  return matches[0] ?? null
}

// Goodreads export columns, of which the rest are ignored.
function parseShelfCsv(text: string): ShelfRow[] {
  const table = parseCsv(text)
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

  const rows: ShelfRow[] = []
  for (const record of table.slice(1)) {
    if (record.length === 0 || (record.length === 1 && record[0] === '')) continue

    const title = cleanCell(record[titleIndex])
    const status = SHELF_STATUS[cleanCell(record[shelfIndex]).toLowerCase()]
    if (!title || !status) continue

    // 0 means unrated, not a zero-star review.
    const rawRating = Number(cleanCell(record[ratingIndex]))
    const rating = Number.isFinite(rawRating) && rawRating > 0 ? rawRating : null

    const readAt = Date.parse(cleanCell(record[readIndex]))

    rows.push({
      title,
      author: cleanCell(record[authorIndex]),
      // ISBN13 preferred; plenty of rows have neither.
      isbn: cleanCell(record[isbn13Index]) || cleanCell(record[isbnIndex]),
      status,
      rating,
      notes: cleanCell(record[reviewIndex]) || null,
      readAt: Number.isNaN(readAt) ? null : readAt,
    })
  }

  return rows
}
