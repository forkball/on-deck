// Log-only: nothing is stored or shown.
export interface PickDrops {
  unfound: number
  alreadyLogged: number
  duplicate: number
  titleMismatch: number
  filtered: number
  length: number
  unverified: number
}

export interface PickTally {
  requested: number
  kept: number
  // Trimmed by the target count, not dropped by a gate — kept apart so a healthy
  // run doesn't read as bleeding picks.
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

// Every pick must land in exactly one bucket; anything else means a gate is
// going uncounted, so the line says so rather than appearing to balance.
export function unaccountedFor(tally: PickTally): number {
  return tally.requested - tally.kept - tally.surplus - totalDropped(tally.dropped)
}

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

// Shaped like the timings line so both can be pulled from the log together.
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
