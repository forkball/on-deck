// Resolves a whole batch at once rather than a row at a time.
//
// Matching each row independently is what created most of the duplicates the
// review page then has to clean up: a row whose year has no exact result falls
// back to the nearest one, and the nearest one is frequently a film another row
// already matched exactly. Solaris 2002 lands on Solaris 1972, the log keeps one
// entry per film, and one of the two viewings silently disappears.
//
// So exact matches are settled first and hold their catalog entry; a fallback
// may not take an entry an exact match is already using. Two *exact* rows are
// still allowed to share one — that is a rewatch, a real thing the review page
// should ask about rather than a mistake to prevent.

import { classifyMatch, normalizeTitle, type CandidateLike, type Verdict } from './classify.ts'

export interface MatchInput {
  rowId: number
  title: string
  year: number | null
  results: CandidateLike[]
  // Matched by an exact identifier (ISBN), so title and year get no say.
  identified?: boolean
}

export interface MatchOutcome {
  rowId: number
  chosen: CandidateLike | null
  verdict: Verdict
}

function exactFor(input: MatchInput): CandidateLike | null {
  if (input.year == null) return null
  const wanted = normalizeTitle(input.title)
  return input.results.find((r) => normalizeTitle(r.title) === wanted && r.releaseYear === input.year) ?? null
}

// The nearest-year fallback the single-row matcher used, minus anything an
// exact match has spoken for.
function fallbackFor(input: MatchInput, blocked: Set<string>): CandidateLike | null {
  const available = input.results.filter((r) => !blocked.has(r.externalId))
  if (available.length === 0) return null
  if (input.year == null) return available[0]

  const sameYear = available.find((r) => r.releaseYear === input.year)
  if (sameYear) return sameYear

  const year = input.year
  return [...available].sort(
    (a, b) => Math.abs((a.releaseYear ?? 0) - year) - Math.abs((b.releaseYear ?? 0) - year),
  )[0]
}

export function resolveBatch(inputs: MatchInput[]): MatchOutcome[] {
  const claimed = new Set<string>()
  const outcomes = new Map<number, MatchOutcome>()

  // Pass zero: identified rows. An ISBN names one edition, so a subtitle the
  // publisher added is not grounds to doubt it.
  for (const input of inputs) {
    if (!input.identified) continue

    const chosen = input.results[0]
    if (!chosen) continue

    claimed.add(chosen.externalId)
    outcomes.set(input.rowId, {
      rowId: input.rowId,
      chosen,
      verdict: { state: 'confident', reason: 'exact', yearDelta: null },
    })
  }

  // Pass one: rows the catalog agrees with outright. They claim their entry,
  // and several rows claiming the same one is left alone — that is the rewatch
  // case, and forcing them apart would invent a wrong match to avoid a question.
  for (const input of inputs) {
    if (outcomes.has(input.rowId)) continue

    const exact = exactFor(input)
    if (!exact) continue

    claimed.add(exact.externalId)
    outcomes.set(input.rowId, {
      rowId: input.rowId,
      chosen: exact,
      verdict: classifyMatch(input, exact),
    })
  }

  // Pass two: everything else, choosing only from entries no exact match holds.
  for (const input of inputs) {
    if (outcomes.has(input.rowId)) continue

    const chosen = fallbackFor(input, claimed)
    outcomes.set(input.rowId, {
      rowId: input.rowId,
      chosen,
      verdict: classifyMatch(input, chosen),
    })
  }

  return inputs.map((input) => outcomes.get(input.rowId) as MatchOutcome)
}
