import { AsyncLocalStorage } from 'node:async_hooks'

// Where a run's time went: the queue, then each phase, then the awaits inside it.
//
// Phase durations are wall clock and add up to the run. Step durations are
// time-in-flight and deliberately don't — eight fetches running at once each
// contribute their full duration to a span they shared. That gap is the point: a
// step total well above its phase means the fan-out is working, one that matches
// it means those calls ran in series.
export interface StepTiming {
  name: string
  ms: number
  count: number
}

export interface PhaseTiming {
  name: string
  ms: number
  // Sorted slowest-first, since that's the only order anyone reads them in.
  steps: StepTiming[]
}

export interface RunTimings {
  // Enqueue to claim. Null when generation was called directly rather than
  // through the queue.
  queuedMs: number | null
  // A resumed job skips whatever its checkpoint holds, so its phases come out
  // cheap for a reason that has nothing to do with speed.
  attempt: number
  totalMs: number
  phases: PhaseTiming[]
}

interface PhaseRecord {
  name: string
  startedAt: number
  // Null while the phase is still open.
  ms: number | null
  steps: Map<string, StepTiming>
}

// Ambient rather than threaded through the pipeline: the calls worth timing are
// leaves, four modules down from the run that owns them, and a recorder argument
// would put measurement in every signature between. One store per run keeps
// concurrent runs on the same machine apart.
const storage = new AsyncLocalStorage<Recorder>()

class Recorder {
  private readonly startedAt = Date.now()
  private readonly phases: PhaseRecord[] = []

  constructor(
    private readonly queuedMs: number | null,
    private readonly attempt: number,
  ) {}

  openPhase(name: string): void {
    this.closeOpenPhase()
    this.phases.push({ name, startedAt: Date.now(), ms: null, steps: new Map() })
  }

  // A step is filed under the phase open when it *started*. Reading it at
  // completion would file a stage's last call against whatever stage began
  // while it was still in the air.
  currentPhase(): PhaseRecord {
    const open = this.phases.at(-1)
    if (open && open.ms == null) return open

    // Unreachable while the pipeline opens `profiles` before its first await,
    // but dropping the measurement is the wrong way to find out otherwise.
    const fallback: PhaseRecord = { name: 'unphased', startedAt: Date.now(), ms: null, steps: new Map() }
    this.phases.push(fallback)
    return fallback
  }

  recordStep(phase: PhaseRecord, name: string, ms: number): void {
    const existing = phase.steps.get(name)
    if (existing) {
      existing.ms += ms
      existing.count += 1
      return
    }
    phase.steps.set(name, { name, ms, count: 1 })
  }

  finish(): RunTimings {
    this.closeOpenPhase()
    return {
      queuedMs: this.queuedMs,
      attempt: this.attempt,
      totalMs: Date.now() - this.startedAt,
      phases: this.phases.map((phase) => ({
        name: phase.name,
        ms: phase.ms ?? 0,
        steps: [...phase.steps.values()].sort((a, b) => b.ms - a.ms),
      })),
    }
  }

  private closeOpenPhase(): void {
    const open = this.phases.at(-1)
    if (open && open.ms == null) open.ms = Date.now() - open.startedAt
  }
}

export interface TimingRecorder {
  // Everything inside becomes the active run for markPhase/track.
  run: <T>(operation: () => Promise<T>) => Promise<T>
  // Safe to call after a failure, and worth doing: a run that died on a hung
  // provider is exactly the one whose timings answer why.
  finish: () => RunTimings
}

export function startTimings(options: { queuedMs: number | null; attempt: number }): TimingRecorder {
  const recorder = new Recorder(options.queuedMs, options.attempt)
  return {
    run: (operation) => storage.run(recorder, operation),
    finish: () => recorder.finish(),
  }
}

// No-ops outside a timed run, so nothing has to know whether it's being
// measured.
export function markPhase(name: string): void {
  storage.getStore()?.openPhase(name)
}

export async function track<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const recorder = storage.getStore()
  if (!recorder) return operation()

  const phase = recorder.currentPhase()
  const startedAt = Date.now()
  try {
    return await operation()
  } finally {
    // In `finally` — a call that threw still spent the time, and the throwing
    // ones are usually the slow ones.
    recorder.recordStep(phase, name, Date.now() - startedAt)
  }
}

// Milliseconds below a second, because the database steps live down there and
// rounding them all to "0.0s" would hide the exact thing they were added to
// show. Seconds above it, since nobody reads a model call as 24173ms.
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

// One line, built to be grepped out of the logs and skimmed: phases in the
// order they ran, each followed by its own steps.
export function summarizeTimings(timings: RunTimings): string {
  const parts = [
    `total ${duration(timings.totalMs)}`,
    timings.queuedMs == null ? 'queue n/a' : `queue ${duration(timings.queuedMs)}`,
  ]
  if (timings.attempt > 1) parts.push(`attempt ${timings.attempt}`)

  for (const phase of timings.phases) {
    const steps = phase.steps.map((step) => `${step.name} ${duration(step.ms)}×${step.count}`).join(', ')
    parts.push(steps ? `${phase.name} ${duration(phase.ms)} [${steps}]` : `${phase.name} ${duration(phase.ms)}`)
  }

  return parts.join(' · ')
}
