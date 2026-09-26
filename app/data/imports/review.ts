// Turns a staged batch into the buckets the review page renders.
//
// Pure on purpose: it takes rows, the catalog entries they resolved to and
// whatever the person already has logged, and returns what to show. The
// bucketing rules are the part worth testing, and none of them need a database.

import {
  classifyDuplicate,
  conflictFields,
  describeReason,
  bulkKind,
  suspicion,
  type BulkKind,
  type CandidateLike,
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
  logStatus: 'consumed' | 'in_progress' | 'want_to_consume'
  author: string | null
  state: RowState
  reason: MatchReason | null
  yearDelta: number | null
  mediaItemId: number | null
  matchedExternalId: string | null
  // A no-year row's namesakes (inlineAlternates).
  alternates: CandidateLike[] | null
  acceptedBy: BulkKind | null
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
  // Matched without help; rows settled by hand are `confirmedCount`.
  confidentCount: number
  confirmedCount: number
  // Already logged exactly as the file has them: counted as unchanged, never written.
  alreadyLoggedIds: number[]
  leftOutRows: StagedRow[]
  sections: SectionProgress[]
  // Rows each one-tap accept would clear, and rows each has already taken.
  bulk: Record<BulkKind, number[]>
  accepted: Record<BulkKind, number[]>
  // Rows already answered in each section, so an answer can be changed.
  answered: Record<SectionKey, ReviewRow[]>
  // `save` is rows written, not log growth: two rows can land on one film.
  counts: { total: number; save: number; unchanged: number; leftOut: number }
}

function verdictOf(row: StagedRow): Verdict {
  // Settled by hand, so it ranks first when two rows land on one film.
  if (row.state === 'confirmed') return { state: 'confident', reason: 'exact', yearDelta: 0 }
  const state =
    row.state === 'not_found' ? 'not_found' : row.state === 'confident' ? 'confident' : 'uncertain'
  return { state, reason: row.reason, yearDelta: row.yearDelta }
}

// A row's section is its flag reason; unplaced rows are "not found" however settled.
export type SectionKey = 'title_differs' | 'no_year' | 'year_drift' | 'not_found'

export interface SectionProgress {
  key: SectionKey
  total: number
  open: number
}

const SECTION_ORDER: SectionKey[] = ['title_differs', 'no_year', 'year_drift', 'not_found']

function sectionOf(row: StagedRow): SectionKey | null {
  if (row.reason === 'title_differs' || row.reason === 'no_year' || row.reason === 'year_drift')
    return row.reason
  if (
    row.reason == null &&
    (row.state === 'not_found' || row.state === 'confirmed' || row.state === 'skipped')
  ) {
    return 'not_found'
  }
  return null
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
  // Once saved the log matches every row, so nothing reads as already logged.
  { saved = false }: { saved?: boolean } = {},
): ReviewModel {
  const duplicates = findDuplicates(rows, items)
  const held = heldBack(duplicates)

  const conflicts: ConflictEntry[] = []
  const uncertain: ReviewRow[] = []
  const notFound: ReviewRow[] = []
  let confidentCount = 0
  let confirmedCount = 0
  const alreadyLoggedIds: number[] = []

  let keptCount = 0

  for (const row of rows) {
    if (row.state === 'skipped') continue
    // Decided already, in favour of what is logged. Counted, not listed.
    if (row.state === 'kept') {
      keptCount++
      continue
    }
    // Half of a duplicate pair. It is shown by its duplicate card and held out
    // of the log until that is decided, so it belongs to no other bucket —
    // counting it as confident would put it in both the save total and the
    // left-out total at once.
    if (held.has(row.id)) continue

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
        if (!saved) {
          alreadyLoggedIds.push(row.id)
          continue
        }
      }
    }

    if (row.state === 'uncertain') {
      uncertain.push({ row, item, chip: describeReason(verdictOf(row)) })
    } else if (row.state === 'confirmed') {
      confirmedCount++
    } else {
      confidentCount++
    }
  }

  // Least certain first: the value is front-loaded, so stopping early is a
  // legitimate way to finish a 400-row import.
  uncertain.sort((a, b) => suspicion(verdictOf(b.row)) - suspicion(verdictOf(a.row)))

  const bulk: Record<BulkKind, number[]> = { year: [], subtitle: [], sole: [] }
  const accepted: Record<BulkKind, number[]> = { year: [], subtitle: [], sole: [] }
  for (const row of rows) {
    if (row.state === 'confirmed' && row.acceptedBy) accepted[row.acceptedBy].push(row.id)
  }
  for (const { row, item } of uncertain) {
    const match = item ? { externalId: '', title: item.title, releaseYear: item.releaseYear } : null
    const kind = bulkKind(verdictOf(row), row.title, match, row.alternates?.length ?? null)
    if (kind) bulk[kind].push(row.id)
  }

  // A row confirmed by hand beats the batch default: someone pressing Take on
  // one conflict means that row, whatever the switch above it says.
  const taken = conflicts.filter(({ row }) => conflictChoice === 'take' || row.state === 'confirmed').length
  const unchanged = conflicts.length - taken + keptCount + alreadyLoggedIds.length
  const save = confidentCount + confirmedCount + uncertain.length + taken
  const leftOutRows = rows.filter(
    (row) => row.state === 'not_found' || row.state === 'skipped' || held.has(row.id),
  )
  const leftOut = leftOutRows.length

  // Conflicts and held duplicates have their own cards.
  const elsewhere = new Set([...conflicts.map(({ row }) => row.id), ...held])
  const answered: Record<SectionKey, ReviewRow[]> = {
    title_differs: [],
    no_year: [],
    year_drift: [],
    not_found: [],
  }
  for (const row of rows) {
    if ((row.state !== 'confirmed' && row.state !== 'skipped') || elsewhere.has(row.id)) continue
    const key = sectionOf(row)
    if (!key) continue
    const item = row.mediaItemId == null ? null : (items.get(row.mediaItemId) ?? null)
    answered[key].push({ row, item, chip: row.state === 'confirmed' ? null : describeReason(verdictOf(row)) })
  }

  const totals = new Map<SectionKey, number>()
  for (const row of rows) {
    const key = sectionOf(row)
    if (key) totals.set(key, (totals.get(key) ?? 0) + 1)
  }
  const open = (key: SectionKey) =>
    key === 'not_found' ? notFound.length : uncertain.filter(({ row }) => row.reason === key).length
  const sections = SECTION_ORDER.filter((key) => totals.has(key)).map((key) => ({
    key,
    total: totals.get(key)!,
    open: open(key),
  }))

  return {
    conflicts,
    duplicates,
    sections,
    uncertain,
    notFound,
    confidentCount,
    confirmedCount,
    alreadyLoggedIds,
    leftOutRows,
    bulk,
    accepted,
    answered,
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
