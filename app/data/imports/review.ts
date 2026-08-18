// Turns a staged batch into the buckets the review page renders.
//
// Pure on purpose: it takes rows, the catalog entries they resolved to and
// whatever the person already has logged, and returns what to show. The
// bucketing rules are the part worth testing, and none of them need a database.

import {
  classifyDuplicate,
  conflictFields,
  describeReason,
  isBulkAcceptable,
  suspicion,
  type ConflictChoice,
  type ConflictField,
  type DuplicateRow,
  type DuplicateVerdict,
  type LogValues,
  type MatchReason,
  type RowState,
  type Verdict,
} from './classify.ts'

export interface StagedRow {
  id: number
  rowIndex: number
  title: string
  year: number | null
  rating: number | null
  disliked: boolean | null
  notes: string | null
  consumedAt: number | null
  state: RowState
  reason: MatchReason | null
  yearDelta: number | null
  mediaItemId: number | null
}

export interface CatalogEntry {
  id: number
  title: string
  releaseYear: number | null
  creator: string | null
  posterUrl: string | null
}

export interface ExistingEntry extends LogValues {
  mediaItemId: number
}

export interface ReviewRow {
  row: StagedRow
  item: CatalogEntry | null
  chip: string | null
}

export interface ConflictEntry {
  row: StagedRow
  item: CatalogEntry
  existing: LogValues
  incoming: LogValues
  fields: ConflictField[]
}

export interface DuplicateEntry {
  item: CatalogEntry
  verdict: DuplicateVerdict
}

export interface ReviewModel {
  conflicts: ConflictEntry[]
  duplicates: DuplicateEntry[]
  uncertain: ReviewRow[]
  notFound: ReviewRow[]
  confidentCount: number
  // How many of `uncertain` the one bulk accept would clear.
  bulkAcceptable: number
  // The footer's arithmetic. `unchanged` only moves when conflicts are kept;
  // taking the import turns them into updates instead.
  counts: { total: number; save: number; unchanged: number; leftOut: number }
}

function verdictOf(row: StagedRow): Verdict {
  const state = row.state === 'not_found' ? 'not_found' : row.state === 'confident' ? 'confident' : 'uncertain'
  return { state, reason: row.reason, yearDelta: row.yearDelta }
}

function valuesOf(row: StagedRow): LogValues {
  return { rating: row.rating, disliked: row.disliked, consumedAt: row.consumedAt, notes: row.notes }
}

// A row is holding a decision open when it is one half of a duplicate pair. It
// is staged but not counted as saving, because writing it would overwrite the
// other half rather than sit alongside it.
function heldBack(duplicates: DuplicateEntry[]): Set<number> {
  const held = new Set<number>()
  for (const { verdict } of duplicates) {
    held.add(verdict.kind === 'different_films' ? verdict.move.id : verdict.drop.id)
  }
  return held
}

export function buildReview(
  rows: StagedRow[],
  items: Map<number, CatalogEntry>,
  existing: Map<number, ExistingEntry>,
  conflictChoice: ConflictChoice,
): ReviewModel {
  const duplicates = findDuplicates(rows, items)
  const held = heldBack(duplicates)

  const conflicts: ConflictEntry[] = []
  const uncertain: ReviewRow[] = []
  const notFound: ReviewRow[] = []
  let confidentCount = 0

  let keptCount = 0

  for (const row of rows) {
    if (row.state === 'skipped') continue
    // Decided already, in favour of what is logged. Counted, not listed.
    if (row.state === 'kept') {
      keptCount++
      continue
    }

    if (row.state === 'not_found') {
      notFound.push({ row, item: null, chip: null })
      continue
    }

    const item = row.mediaItemId == null ? null : (items.get(row.mediaItemId) ?? null)

    // A row already in the log with different details is the only kind that
    // would overwrite something, so it outranks whatever matching thought of
    // it and is reported as a conflict rather than as an uncertain match.
    if (item) {
      const already = existing.get(item.id)
      if (already) {
        const fields = conflictFields(already, valuesOf(row))
        // No disagreement is nothing to decide, so it never reaches the page.
        if (fields.length > 0) {
          conflicts.push({ row, item, existing: already, incoming: valuesOf(row), fields })
          continue
        }
      }
    }

    if (row.state === 'uncertain') {
      uncertain.push({ row, item, chip: describeReason(verdictOf(row)) })
    } else {
      confidentCount++
    }
  }

  // Least certain first: the value is front-loaded, so stopping early is a
  // legitimate way to finish a 400-row import.
  uncertain.sort((a, b) => suspicion(verdictOf(b.row)) - suspicion(verdictOf(a.row)))

  const bulkAcceptable = uncertain.filter(({ row }) => isBulkAcceptable(verdictOf(row))).length

  // A row confirmed by hand beats the batch default: someone pressing Take on
  // one conflict means that row, whatever the switch above it says.
  const taken = conflicts.filter(({ row }) => conflictChoice === 'take' || row.state === 'confirmed').length
  const unchanged = conflicts.length - taken + keptCount
  const save = confidentCount + uncertain.filter(({ row }) => !held.has(row.id)).length + taken
  const leftOut = notFound.length + rows.filter((row) => row.state === 'skipped').length + held.size

  return {
    conflicts,
    duplicates,
    uncertain,
    notFound,
    confidentCount,
    bulkAcceptable,
    counts: { total: rows.length, save, unchanged, leftOut },
  }
}

// Rows that resolved to the same catalog entry. The log keeps one entry per
// film, so without a decision the second write would silently overwrite the
// first — which is how a mis-matched row used to eat a real one.
function findDuplicates(rows: StagedRow[], items: Map<number, CatalogEntry>): DuplicateEntry[] {
  const byItem = new Map<number, StagedRow[]>()

  for (const row of rows) {
    if (row.mediaItemId == null || row.state === 'skipped' || row.state === 'not_found') continue
    const group = byItem.get(row.mediaItemId)
    if (group) group.push(row)
    else byItem.set(row.mediaItemId, [row])
  }

  const duplicates: DuplicateEntry[] = []

  for (const [itemId, group] of byItem) {
    if (group.length < 2) continue
    const item = items.get(itemId)
    if (!item) continue

    // Reported pairwise against the first row rather than as one n-way group:
    // three rows on one film is two separate mistakes, and each wants its own
    // answer. Rare enough that the extra cards are not worth collapsing.
    const [first, ...rest] = group
    for (const other of rest) {
      duplicates.push({ item, verdict: classifyDuplicate(toDuplicateRow(first), toDuplicateRow(other)) })
    }
  }

  return duplicates
}

function toDuplicateRow(row: StagedRow): DuplicateRow {
  return {
    id: row.id,
    index: row.rowIndex,
    title: row.title,
    year: row.year,
    consumedAt: row.consumedAt,
    verdict: verdictOf(row),
  }
}
