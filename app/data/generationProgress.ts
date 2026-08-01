// Live progress for an in-flight recommendation run.
//
// Generating takes tens of seconds across several distinct stages, two of
// which are model calls. Previously the request simply blocked for the whole
// thing and the button cycled invented captions on a timer. This lets the
// server say which stage it is actually in.
//
// Deliberately in memory rather than a table. Progress is worthless the
// moment the process holding the work dies — the generation dies with it —
// so persisting it would only preserve a record of something that is no
// longer happening. It does mean this only works while the app runs as a
// single machine, which fly.toml currently specifies; more than one, and a
// poll could land somewhere that never heard of the job.
export type GenerationPhase = 'profiles' | 'picks' | 'matching' | 'lengths' | 'verifying' | 'saving'

// Wording shown to the user, in the order the generation moves through them.
// Each one corresponds to a real await in generateRecommendations — if a
// stage is added there, it belongs here too, and vice versa.
export const PHASE_LABELS: Record<GenerationPhase, string> = {
  profiles: 'Reading what everyone has logged…',
  picks: 'Choosing picks…',
  matching: 'Looking each one up…',
  lengths: 'Checking lengths…',
  verifying: 'Making sure they match…',
  saving: 'Saving your picks…',
}

export const PHASE_ORDER: GenerationPhase[] = [
  'profiles',
  'picks',
  'matching',
  'lengths',
  'verifying',
  'saving',
]

export interface GenerationJob {
  userId: number
  // The stages this particular run will actually go through. Not every run
  // hits every stage — the length check only happens when a length lever is
  // set — and listing a stage that never runs, then ticking it complete,
  // would be exactly the invented progress this replaced.
  phases: GenerationPhase[]
  phase: GenerationPhase
  // Set once finished; the client navigates here.
  runId?: number
  prunedOldestRun?: boolean
  error?: string
  startedAt: number
  updatedAt: number
}

const jobs = new Map<string, GenerationJob>()

// Long enough for a finished job to be collected by the poll that follows it,
// short enough that abandoned jobs don't accumulate. Nothing schedules this —
// it's swept on access, so an idle process holds no timers.
const JOB_TTL_MS = 10 * 60 * 1000

function sweep(): void {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id)
  }
}

export function createJob(userId: number, options: { withLengthCheck: boolean }): string {
  sweep()
  const id = crypto.randomUUID()
  const now = Date.now()
  const phases = options.withLengthCheck ? PHASE_ORDER : PHASE_ORDER.filter((phase) => phase !== 'lengths')
  jobs.set(id, { userId, phases, phase: 'profiles', startedAt: now, updatedAt: now })
  return id
}

export function setPhase(jobId: string, phase: GenerationPhase): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.phase = phase
  job.updatedAt = Date.now()
}

export function completeJob(jobId: string, runId: number, prunedOldestRun: boolean): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.runId = runId
  job.prunedOldestRun = prunedOldestRun
  job.updatedAt = Date.now()
}

export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.error = error
  job.updatedAt = Date.now()
}

// Scoped by user: a job id is a bearer token otherwise, and someone else's
// progress is nobody's business.
export function getJob(jobId: string, userId: number): GenerationJob | null {
  sweep()
  const job = jobs.get(jobId)
  if (!job || job.userId !== userId) return null
  return job
}
