import { AsyncLocalStorage } from 'node:async_hooks'

// Phase durations are wall clock and add up to the run. Step durations are
// time-in-flight and deliberately don't — concurrent calls each contribute their
// full duration to a span they shared, so a step total above its phase is the
// fan-out working. `count` is what makes the two readable apart.
export interface StepTiming {
  name: string
  ms: number
  count: number
}

export interface PhaseTiming {
  name: string
  ms: number
  steps: StepTiming[]
}

export interface RunTimings {
  queuedMs: number | null
  // A resumed job skips what its checkpoint holds, so its phases come out cheap
  // for a reason that has nothing to do with speed.
  attempt: number
  totalMs: number
  phases: PhaseTiming[]
}

interface PhaseRecord {
  name: string
  startedAt: number
  ms: number | null
  steps: Map<string, StepTiming>
}

// One store per run, which is what keeps concurrent runs on the same machine
// from recording into each other.
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

  // A step is filed under the phase open when it *started* — reading it at
  // completion files a stage's last call against whatever stage began while it
  // was still in the air.
  currentPhase(): PhaseRecord {
    const open = this.phases.at(-1)
    if (open && open.ms == null) return open

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
  run: <T>(operation: () => Promise<T>) => Promise<T>
  // Safe to call after a failure, and worth doing.
  finish: () => RunTimings
}

export function startTimings(options: { queuedMs: number | null; attempt: number }): TimingRecorder {
  const recorder = new Recorder(options.queuedMs, options.attempt)
  return {
    run: (operation) => storage.run(recorder, operation),
    finish: () => recorder.finish(),
  }
}

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
    // In `finally`: a call that threw still spent the time.
    recorder.recordStep(phase, name, Date.now() - startedAt)
  }
}

// Milliseconds below a second — the database steps live down there, and rounding
// them to "0.0s" hides what they were added to show.
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

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
