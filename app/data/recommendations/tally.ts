// Where a run's suggestions went. The pipeline over-requests and puts the picks
// through a series of gates, any of which can quietly take one — so a short run
// looks identical to a broken one, and neither says which gate did it.
//
// Log-only: nothing is stored or shown. The open question is only whether runs
// come up short at all.
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
  // Survived every gate and was trimmed by the target count. Not a loss — this
  // is the over-request working — so it's kept apart from the drops.
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

// Every pick lands in exactly one bucket. If that doesn't hold a gate is going
// uncounted, which is worse than no numbers at all — so the line says so.
export function unaccountedFor(tally: PickTally): number {
  return tally.requested - tally.kept - tally.surplus - totalDropped(tally.dropped)
}

// Logged where it's counted rather than returned up to the worker: this is
// complete the moment the picks are, unlike timings.
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

// One line, shaped like the timings one so both can be pulled from the log
// together. Zero-count gates are left off as noise.
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
