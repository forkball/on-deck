import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from './catalog.ts'
import { cleanCell, headerIndex, parseCsv, runBounded } from './csvImport.ts'
import type { Db } from './db.ts'
import { logInteraction, type LogInteractionInput } from './mediaCatalog.ts'
import { getBooksByIsbns, normalizeIsbn } from './openLibrary.ts'

export interface GoodreadsImportResult {
  totalRows: number
  imported: number
  // Rows whose book couldn't be found in the catalog at all.
  notFound: { title: string; author: string }[]
  // How many resolved by exact ISBN vs. a title/author guess — surfaced
  // because the second kind is where wrong matches come from.
  matchedByIsbn: number
  matchedByTitle: number
}

// Goodreads' three shelves map exactly onto the app's three statuses, so an
// import preserves your want-to-read list and current reads — unlike the
// Letterboxd one, which can only ever produce "watched".
const SHELF_STATUS: Record<string, LogInteractionInput['status']> = {
  read: 'consumed',
  'currently-reading': 'in_progress',
  'to-read': 'want_to_consume',
}

// Title/author fallback lookups are one request each, unlike the ISBN path
// which resolves 20 at a time — so this bound only really governs the
// fallback.
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

// Imports a Goodreads library export (My Books → Import and export → Export
// Library). Goodreads retired its public API in 2020, so the CSV is the only
// way in — but it's richer than Letterboxd's: it carries ISBNs, so most rows
// resolve to an exact edition rather than a title guess.
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

  // Every ISBN in one pass first: 20 per request instead of one request per
  // book, which is the difference between seconds and minutes on a real
  // library.
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
    const item = await upsertCatalogItem(db, 'book', match)
    await logInteraction(db, userId, item.id, {
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      // Only "read" rows carry a date; a to-read shelf entry has none.
      consumedAt: row.readAt ?? undefined,
    })
    imported++
  })

  return { totalRows: rows.length, imported, notFound, matchedByIsbn, matchedByTitle }
}

async function matchByTitle(title: string, author: string): Promise<CatalogSearchResult | null> {
  const query = author ? `${title} ${author}` : title
  const matches = await getCatalogProvider('book').search(query)
  return matches[0] ?? null
}

// Goodreads export columns: Title, Author, ISBN, ISBN13, My Rating,
// Number of Pages, Original Publication Year, Date Read, Date Added,
// Bookshelves, Exclusive Shelf, My Review, and others we ignore.
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

    // 0 means "unrated" in a Goodreads export, not a zero-star review — the
    // row is still worth importing, just without a rating.
    const rawRating = Number(cleanCell(record[ratingIndex]))
    const rating = Number.isFinite(rawRating) && rawRating > 0 ? rawRating : null

    const readAt = Date.parse(cleanCell(record[readIndex]))

    rows.push({
      title,
      author: cleanCell(record[authorIndex]),
      // ISBN13 preferred; the 10-digit column is the fallback, and plenty of
      // rows have neither.
      isbn: cleanCell(record[isbn13Index]) || cleanCell(record[isbnIndex]),
      status,
      rating,
      notes: cleanCell(record[reviewIndex]) || null,
      readAt: Number.isNaN(readAt) ? null : readAt,
    })
  }

  return rows
}
