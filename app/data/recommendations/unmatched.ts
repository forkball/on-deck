import { sameWorkKey } from '../titles.ts'
import type { ExcludedTitles, Pick } from './picks.ts'

// Type-only imports beyond titles.ts, deliberately: this is the rule for which of
// the model's picks a run shows when no catalog entry could be found for them, and
// keeping it free of the database and the catalog clients is what lets it be
// tested directly — the same reason exclusions.ts is shaped this way.

// What a run keeps of a pick the catalog couldn't place. Only what the model said:
// there is no catalog record behind it, so nothing here claims there is.
export interface UnmatchedPick {
  title: string
  year: number | null
  creator?: string
  reason: string
}

export interface UnmatchedCandidate {
  pick: Pick
  // The pick's own series key, or null — see seriesKey in matching.ts. Passed in
  // rather than computed here, because that normalisation lives with the matcher.
  seriesKey: string | null
}

export interface SelectUnmatchedInput {
  // Picks dropped because the catalog had nothing for them, or nothing with their
  // title, in the order the model ranked them. Picks dropped by a filter, as
  // already logged, or as a duplicate never reach here.
  candidates: UnmatchedCandidate[]
  // The same exclusion list the prompt was given. The catalog-id filter is what
  // normally keeps a logged title out of a run; without an id, the title is the
  // only thing left to compare.
  excluded: ExcludedTitles
  // Titles the run already shows from the catalog, so the same work can't appear
  // in both lists under two spellings.
  shownTitles: string[]
  // Series already represented by a confirmed pick. One per series, as for those.
  takenSeries: ReadonlySet<string>
  // How many places are left once the confirmed picks are counted. A run promises
  // a number of picks, and these fill it rather than growing past it.
  slots: number
}

// The run's exclusion list as a check on a title. Without a catalog id, the title is
// the only thing a pick can be ruled out by — this and picksToKeepUnconfirmed both
// rest on it.
export function excludedByTitle(excluded: ExcludedTitles): (title: string) => boolean {
  const keys = new Set([...excluded.seen, ...excluded.rejected].map(sameWorkKey))
  keys.delete('')
  return (title) => keys.has(sameWorkKey(title))
}

export function selectUnmatchedPicks(input: SelectUnmatchedInput): UnmatchedPick[] {
  const { candidates, excluded, shownTitles, takenSeries, slots } = input
  if (slots <= 0) return []

  const ruledOut = excludedByTitle(excluded)
  const shown = new Set(shownTitles.map(sameWorkKey))
  const series = new Set(takenSeries)
  const kept: UnmatchedPick[] = []

  for (const { pick, seriesKey } of candidates) {
    if (kept.length >= slots) break
    const key = sameWorkKey(pick.title)
    if (!key || ruledOut(pick.title) || shown.has(key)) continue
    if (seriesKey && series.has(seriesKey)) continue

    shown.add(key)
    if (seriesKey) series.add(seriesKey)
    kept.push({
      title: pick.title,
      year: Number.isFinite(pick.year) && pick.year > 0 ? pick.year : null,
      creator: pick.creator?.trim() || undefined,
      reason: pick.reason,
    })
  }

  return kept
}

// A stored list read back. A malformed column reads as empty rather than taking
// the run page down with it.
export function parseUnmatchedPicks(raw: string | null | undefined): UnmatchedPick[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): UnmatchedPick[] => {
      if (!entry || typeof entry !== 'object') return []
      const { title, year, creator, reason } = entry as Record<string, unknown>
      if (typeof title !== 'string' || !title.trim()) return []
      return [
        {
          title,
          year: typeof year === 'number' ? year : null,
          creator: typeof creator === 'string' && creator ? creator : undefined,
          reason: typeof reason === 'string' ? reason : '',
        },
      ]
    })
  } catch {
    return []
  }
}
