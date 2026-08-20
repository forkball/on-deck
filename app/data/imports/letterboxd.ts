import { headerIndex, parseCsv } from './csv.ts'
import { normalizeTitle } from './classify.ts'
import { looksLikeZip, openZip } from './zip.ts'
import { normalizeRating } from '../mediaItems.ts'
import type { ParsedRow } from './batches.ts'

export const RATINGS_FILE = 'ratings.csv'
export const REVIEWS_FILE = 'reviews.csv'

interface SourceRow {
  title: string
  year: number | null
  rating: number | null
  notes: string | null
  consumedAt: number | null
  rowIndex: number
}

export interface LetterboxdUpload {
  rows: ParsedRow[]
  // Reviews without ratings: only the films written about, not what was watched.
  reviewsOnly: boolean
}

export function parseLetterboxdUpload(bytes: Uint8Array): LetterboxdUpload {
  if (!looksLikeZip(bytes)) {
    throw new Error(
      'That looks like a single file rather than the export archive. Upload the .zip Letterboxd emails you — your reviews are in there too.',
    )
  }

  const zip = openZip(bytes)
  const ratings = zip.readText(RATINGS_FILE) ?? undefined
  const reviews = zip.readText(REVIEWS_FILE) ?? undefined

  if (!ratings && !reviews) {
    throw new Error(
      'That zip has no ratings.csv or reviews.csv in it. Upload the export Letterboxd emails you, not a folder you built yourself.',
    )
  }

  return { rows: parseLetterboxdExport({ ratings, reviews }), reviewsOnly: !ratings }
}

export function parseLetterboxdExport(files: { ratings?: string; reviews?: string }): ParsedRow[] {
  const rated = files.ratings ? readRatings(files.ratings) : []
  const reviewed = files.reviews ? readReviews(files.reviews) : []

  if (rated.length === 0 && reviewed.length === 0) return []

  // Merged on title and year, not the export's Letterboxd URI: ratings.csv
  // points at the film and reviews.csv at the review, so it is not a join key.
  const byFilm = new Map<string, SourceRow>()
  for (const row of rated) {
    byFilm.set(filmKey(row), row)
  }

  let nextIndex = rated.reduce((highest, row) => Math.max(highest, row.rowIndex), 1) + 1

  for (const review of reviewed) {
    const existing = byFilm.get(filmKey(review))

    if (!existing) {
      // Reviewed but never rated, so absent from ratings.csv entirely.
      byFilm.set(filmKey(review), { ...review, rowIndex: nextIndex++ })
      continue
    }

    existing.notes = review.notes
    // ratings.csv dates the rating; reviews.csv dates the viewing.
    if (review.consumedAt != null) existing.consumedAt = review.consumedAt
    if (existing.rating == null) existing.rating = review.rating
  }

  return toParsedRows([...byFilm.values()].sort((a, b) => a.rowIndex - b.rowIndex))
}

function filmKey(row: SourceRow): string {
  return `${normalizeTitle(row.title)} ${row.year ?? ''}`
}

function toParsedRows(rows: SourceRow[]): ParsedRow[] {
  return rows.map((row) => ({
    rowIndex: row.rowIndex,
    title: row.title,
    year: row.year,
    rating: row.rating,
    disliked: null,
    notes: row.notes,
    consumedAt: row.consumedAt,
  }))
}

function readRatings(csvText: string): SourceRow[] {
  const table = parseCsv(csvText)
  if (table.length === 0) return []

  const indexOf = headerIndex(table[0])
  const dateIndex = indexOf('date')
  const nameIndex = indexOf('name')
  const ratingIndex = indexOf('rating')

  if (dateIndex === -1 || nameIndex === -1 || ratingIndex === -1) {
    throw new Error('ratings.csv is missing expected columns (Date, Name, Rating).')
  }

  const yearIndex = indexOf('year')
  const rows: SourceRow[] = []

  for (const [offset, record] of table.slice(1).entries()) {
    if (isBlank(record)) continue

    const watchedAt = Date.parse(record[dateIndex])
    if (Number.isNaN(watchedAt)) continue

    rows.push({
      // Line in the file, counting the header — the review page cites it.
      rowIndex: offset + 2,
      title: record[nameIndex],
      year: readYear(record, yearIndex),
      rating: readRating(record, ratingIndex),
      notes: null,
      consumedAt: watchedAt,
    })
  }

  return rows
}

function readReviews(csvText: string): SourceRow[] {
  const table = parseCsv(csvText)
  if (table.length === 0) return []

  const indexOf = headerIndex(table[0])
  const nameIndex = indexOf('name')
  const reviewIndex = indexOf('review')

  if (nameIndex === -1 || reviewIndex === -1) {
    throw new Error('reviews.csv is missing expected columns (Name, Review).')
  }

  const yearIndex = indexOf('year')
  const ratingIndex = indexOf('rating')
  const dateIndex = indexOf('date')
  const watchedIndex = indexOf('watched date')

  const rows: SourceRow[] = []

  for (const [offset, record] of table.slice(1).entries()) {
    if (isBlank(record)) continue

    const title = record[nameIndex]
    const notes = (record[reviewIndex] ?? '').trim()
    // A blank Review is a diary entry; writing it through would clear a note.
    if (!title || !notes) continue

    rows.push({
      rowIndex: offset + 2,
      title,
      year: readYear(record, yearIndex),
      rating: readRating(record, ratingIndex),
      notes,
      consumedAt: readDate(record, watchedIndex) ?? readDate(record, dateIndex),
    })
  }

  return rows
}

function isBlank(record: string[]): boolean {
  return record.length === 0 || (record.length === 1 && record[0] === '')
}

function readYear(record: string[], index: number): number | null {
  return index === -1 ? null : Number(record[index]) || null
}

// `Number('')` is 0; normalizeRating turns that back into unrated.
function readRating(record: string[], index: number): number | null {
  return index === -1 ? null : normalizeRating(Number(record[index]))
}

function readDate(record: string[], index: number): number | null {
  if (index === -1) return null
  const parsed = Date.parse(record[index] ?? '')
  return Number.isNaN(parsed) ? null : parsed
}
