// Where a run's suggestions went. The pipeline asks for more picks than it
// needs and puts them through a series of gates, any of which can quietly take
// one — so a run that comes back short looks identical to one that came back
// broken, and neither says which gate did it.
//
// Log-only for now, deliberately. Nothing is stored and nothing is shown to
// anyone: the open question is whether runs come up short at all, which a few
// days of log lines answers for a fraction of the work of answering it
// properly.
export interface PickDrops {
  // Nothing in the catalog under that title at all.
  unfound: number
  // Already in the log for this media type — seen, or turned down.
  alreadyLogged: number
  // A second pick that resolved to an entry an earlier one already took.
  duplicate: number
  // Found something, but not the thing that was meant.
  titleMismatch: number
  // Failed one of the tag filters the request set.
  filtered: number
  // Outside the requested length bucket.
  length: number
  // Verification said the catalog entry isn't the one the model meant.
  unverified: number
}

export interface PickTally {
  // What the model actually returned.
  requested: number
  // What made it into the run.
  kept: number
  // Survived every gate and was trimmed by the target count. Not a loss —
  // this is the over-request working — and kept apart from the drops for
  // exactly that reason. Counting it as a casualty would make every healthy
  // run look like it was bleeding picks.
  surplus: number
  dropped: PickDrops
}

export function emptyDrops(): PickDrops {
  return {
    unfound: 0,
    alreadyLogged: 0,
    duplicate: 0,
    titleMismatch: 0,
    filtered: 0,
    length: 0,
    unverified: 0,
  }
}

export function totalDropped(drops: PickDrops): number {
  return Object.values(drops).reduce((sum, count) => sum + count, 0)
}

// Every pick the model returned ended up in exactly one of these buckets. If
// that doesn't hold, a gate is going uncounted and the numbers below are
// quietly wrong — which is worse than not having them, so the line says so
// rather than reading as though it balanced.
export function unaccountedFor(tally: PickTally): number {
  return tally.requested - tally.kept - tally.surplus - totalDropped(tally.dropped)
}

// Logged where it's counted rather than returned up to the worker the way
// timings are. Timings can only be finalised after generation returns; this is
// complete the moment the picks are, and widening the pipeline's return type
// for something no code reads would buy nothing.
export function logPickTally(tally: PickTally): void {
  console.info(`[generation] ${summarizePickTally(tally)}`)
}

const DROP_LABELS: Record<keyof PickDrops, string> = {
  unfound: 'unfound',
  alreadyLogged: 'already-logged',
  duplicate: 'duplicate',
  titleMismatch: 'title-mismatch',
  filtered: 'filtered',
  length: 'length',
  unverified: 'unverified',
}

// One line, in the same shape as the timings one so both can be pulled out of
// the log together. Zero-count gates are left off — on a run with no filters
// set, a column of zeroes is just noise around the two numbers that moved.
export function summarizePickTally(tally: PickTally): string {
  const parts = [`picks ${tally.requested} → kept ${tally.kept}`]
  if (tally.surplus > 0) parts.push(`surplus ${tally.surplus}`)

  for (const [key, label] of Object.entries(DROP_LABELS) as [keyof PickDrops, string][]) {
    const count = tally.dropped[key]
    if (count > 0) parts.push(`${label} ${count}`)
  }

  const unaccounted = unaccountedFor(tally)
  if (unaccounted !== 0) parts.push(`UNACCOUNTED ${unaccounted}`)

  return parts.join(' · ')
}
