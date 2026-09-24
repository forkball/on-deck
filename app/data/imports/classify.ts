// How sure we are that a CSV row landed on the right catalog entry, and what to
// tell someone about it. Deliberately free of the database and the catalog: the
// rules are the part worth testing, and they only need the row and the result.

export type MatchReason = 'exact' | 'year_drift' | 'no_year' | 'title_differs'

// pending is the state a row is written in before matching reaches it.
// confident/uncertain/not_found are what matching leaves behind; the rest are
// what review writes over them. `kept` is a conflict decided in favour of the
// log — nothing is written, but nothing is lost either, which is why it is not
// the same as `skipped`.
export type RowState = 'pending' | 'confident' | 'uncertain' | 'not_found' | 'confirmed' | 'skipped' | 'kept'

export interface CandidateLike {
  externalId: string
  title: string
  releaseYear: number | null
}

export interface RowLike {
  title: string
  year: number | null
}

export interface Verdict {
  state: Extract<RowState, 'confident' | 'uncertain' | 'not_found'>
  reason: MatchReason | null
  // Signed, so "matched 30 years later" and "30 years earlier" stay
  // distinguishable; the copy only uses its magnitude.
  yearDelta: number | null
}

// Trademark symbols, punctuation and spacing differ constantly between an
// export and a catalog ("WALL·E" / "WALL-E"), so titles compare on letters and
// digits only. Same normalization the Steam importer settled on.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// `results` is the whole result set the match came from, not just the winner:
// two results sharing the chosen title and year is the only way to know a match
// was a coin toss rather than a lookup.
export function classifyMatch(row: RowLike, match: CandidateLike | null): Verdict {
  if (!match) return { state: 'not_found', reason: null, yearDelta: null }

  const sameTitle = normalizeTitle(row.title) === normalizeTitle(match.title)

  if (!sameTitle) {
    return { state: 'uncertain', reason: 'title_differs', yearDelta: yearDelta(row.year, match.releaseYear) }
  }

  // A row with no year gives the matcher nothing to disambiguate on, so even a
  // perfect title is a guess between every film that ever carried it.
  if (row.year == null) {
    return { state: 'uncertain', reason: 'no_year', yearDelta: null }
  }

  const delta = yearDelta(row.year, match.releaseYear)
  if (delta == null || delta !== 0) {
    return { state: 'uncertain', reason: 'year_drift', yearDelta: delta }
  }

  // Title and year both exact is the strongest evidence there is, even when
  // several catalog entries tie on it. Flagging those ties bought nothing: the
  // card cannot show which rival it means without opening the picker, so it
  // asked for a decision it gave no way to make — and on a real 834-row import
  // every one of them had already matched the intended film. A wrong match is
  // still fixable afterwards from the film's own page.
  return { state: 'confident', reason: 'exact', yearDelta: 0 }
}

function yearDelta(rowYear: number | null, matchYear: number | null): number | null {
  if (rowYear == null || matchYear == null) return null
  return matchYear - rowYear
}

// Review lists least-certain first, so the value is front-loaded and stopping
// early is a legitimate way to finish. Higher sorts earlier.
export function suspicion(verdict: Verdict): number {
  switch (verdict.reason) {
    case 'title_differs':
      return 1000
    case 'no_year':
      return 500
    case 'year_drift':
      // A 30-year gap is a different film; a 1-year gap is usually a festival
      // or re-release date, so magnitude is the whole signal here.
      return 100 + Math.min(Math.abs(verdict.yearDelta ?? 0), 99)
    default:
      return 0
  }
}

// Fits after the row, as a chip — only where it says more than the group
// heading the row sits under (reasonGroup). How far out a year is varies by
// row; "title differs" and "no year" don't.
export function describeReason(verdict: Verdict): string | null {
  const magnitude = Math.abs(verdict.yearDelta ?? 0)
  return verdict.reason === 'year_drift'
    ? magnitude === 1
      ? 'Year off by 1'
      : `Year off by ${magnitude}`
    : null
}

// The heading and one-line explanation for the review's group of rows flagged
// for `reason`. Beside describeReason so the wording for a reason lives in one
// place.
export function reasonGroup(
  reason: MatchReason | null,
  singular: string,
  plural: string,
): { title: string; blurb: string } {
  switch (reason) {
    case 'title_differs':
      return {
        title: 'Different title',
        blurb: `The catalog's title isn't the one in your file — often a subtitle, or a different ${singular}.`,
      }
    case 'no_year':
      return {
        title: 'No year in your file',
        blurb: `Several ${plural} share these names. Pick the one you meant.`,
      }
    case 'year_drift':
      return {
        title: "Year doesn't match",
        blurb: 'A year or so out is usually a festival or re-release date; further out may be a remake.',
      }
    default:
      return { title: 'Worth checking', blurb: '' }
  }
}

// The long tail of a large import: near-miss years, which are almost always a
// festival or re-release date rather than a wrong film. Offered as one bulk
// accept so 400 rows don't become 400 decisions.
export const BULK_ACCEPT_MAX_DRIFT = 1

export function isBulkAcceptable(verdict: Verdict): boolean {
  return verdict.reason === 'year_drift' && Math.abs(verdict.yearDelta ?? 0) <= BULK_ACCEPT_MAX_DRIFT
}

// Whether the catalog's title is the row's title with a subtitle added —
// "Mission: Impossible" matched to "Mission: Impossible – Fallout", or a
// Letterboxd "Birdman" matched to "Birdman: A Love Story". The subtitle has to
// follow a real separator (a colon or a spaced dash), so "Birdman or (The
// Unexpected Virtue of Ignorance)" doesn't count: that could as easily be a
// different film that happens to start the same way.
export function isSubtitleOnly(rowTitle: string, matchTitle: string): boolean {
  const wanted = normalizeTitle(rowTitle)
  if (!wanted) return false

  for (const separator of matchTitle.matchAll(/\s*(?::|\s[-–—])\s+/g)) {
    const before = matchTitle.slice(0, separator.index)
    const after = matchTitle.slice(separator.index + separator[0].length)
    if (normalizeTitle(before) === wanted && after.trim()) return true
  }
  return false
}

// The review's two one-tap accepts, and which one (if either) covers a row.
// Year drift within a year is the festival/re-release tail; a subtitle added
// in the same year is the other long tail of a real export. Both leave anything
// that could plausibly be a different film to be looked at one by one.
export type BulkKind = 'year' | 'subtitle'

export function bulkKind(verdict: Verdict, rowTitle: string, match: CandidateLike | null): BulkKind | null {
  if (isBulkAcceptable(verdict)) return 'year'
  if (
    verdict.reason === 'title_differs' &&
    verdict.yearDelta === 0 &&
    match &&
    isSubtitleOnly(rowTitle, match.title)
  ) {
    return 'subtitle'
  }
  return null
}

export interface DuplicateRow {
  id: number
  // The line in the uploaded file. What the page calls the row, since "row 288"
  // has to mean something a person can go and look at.
  index: number
  title: string
  year: number | null
  consumedAt: number | null
  verdict: Verdict
}

// Two rows resolving to one catalog entry. `different_films` is the common
// case — one row matched wrong and the two are separate works sharing a name —
// so nothing is dropped and `move` names the row to repoint. `repeat` is one
// film logged twice, where keeping one entry is right.
export type DuplicateVerdict =
  | { kind: 'different_films'; move: DuplicateRow; anchor: DuplicateRow }
  | { kind: 'repeat'; keep: DuplicateRow; drop: DuplicateRow }

// Told apart by the years in the CSV itself, not by the catalog: if the export
// says 1972 and 2002, the person logged two different films, whatever the
// matcher decided. Only rows agreeing on title and year are a real repeat.
export function classifyDuplicate(a: DuplicateRow, b: DuplicateRow): DuplicateVerdict {
  const differentYears = a.year != null && b.year != null && a.year !== b.year
  const differentTitles = normalizeTitle(a.title) !== normalizeTitle(b.title)

  if (differentYears || differentTitles) {
    // The row whose own year the match agrees with is the anchor; the other is
    // the one that drifted onto it and should move.
    const [anchor, move] = suspicion(a.verdict) <= suspicion(b.verdict) ? [a, b] : [b, a]
    return { kind: 'different_films', move, anchor }
  }

  // A rewatch: the later watch is what the log should end up showing, since one
  // entry per film means the most recent viewing is the live one.
  const [keep, drop] = (a.consumedAt ?? 0) >= (b.consumedAt ?? 0) ? [a, b] : [b, a]
  return { kind: 'repeat', keep, drop }
}

export type ConflictField = 'rating' | 'watched' | 'notes'

export interface LogValues {
  rating: number | null
  disliked: boolean | null
  consumedAt: number | null
  notes: string | null
}

// Only fields that actually disagree. A re-import of an unchanged export
// therefore raises nothing at all, which is what keeps a large duplicate import
// from becoming hundreds of decisions.
export function conflictFields(existing: LogValues, incoming: LogValues): ConflictField[] {
  const fields: ConflictField[] = []

  if (incoming.rating !== existing.rating || incoming.disliked !== existing.disliked) {
    fields.push('rating')
  }
  // Compared by calendar day: an export carries a date, the log carries the
  // millisecond it was written, and a few hours apart is the same viewing.
  if (!sameDay(incoming.consumedAt, existing.consumedAt)) {
    fields.push('watched')
  }
  if (normalizeNote(incoming.notes) !== normalizeNote(existing.notes)) {
    fields.push('notes')
  }

  return fields
}

function sameDay(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)
}

function normalizeNote(note: string | null): string {
  return (note ?? '').trim()
}

// What a conflicting row does when the person hasn't said otherwise. `keep` is
// the default because it is the only direction that destroys nothing.
export type ConflictChoice = 'keep' | 'take'

// The same-titled films a no-year row could have meant, when there are few
// enough to offer as buttons on the card. Two is the least that makes it a
// choice; past three it is a list, and the picker — with posters and a search
// box — is the better place to choose from one. Matching's own pick leads, so
// the card reads "ours, or one of these".
export const MAX_INLINE_ALTERNATES = 3

export function inlineAlternates(
  row: RowLike,
  verdict: Verdict,
  chosen: CandidateLike | null,
  results: CandidateLike[],
): CandidateLike[] | null {
  if (verdict.reason !== 'no_year' || !chosen) return null

  const wanted = normalizeTitle(row.title)
  const seen = new Set<string>()
  const namesakes: CandidateLike[] = []

  for (const result of [chosen, ...results]) {
    if (seen.has(result.externalId) || normalizeTitle(result.title) !== wanted) continue
    seen.add(result.externalId)
    namesakes.push({ externalId: result.externalId, title: result.title, releaseYear: result.releaseYear })
  }

  return namesakes.length >= 2 && namesakes.length <= MAX_INLINE_ALTERNATES ? namesakes : null
}
