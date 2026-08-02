import { lt } from 'remix/data-table'

import type { Db } from './db.ts'
import { recommendationJobs, type RecommendationJob } from './schema.ts'

// Live progress for an in-flight recommendation run.
//
// Generating takes tens of seconds across several distinct stages, two of
// which are model calls. The request doesn't block for it: it starts the work
// and hands back a job id, and the wait page reports the stage from here.
//
// This was in process memory, on the reasoning that progress is worthless
// once the process holding the work dies. That reasoning was about
// persistence and missed the actual requirement — the *reader* is a different
// process. A single [[vm]] block in fly.toml sets the machine size, not the
// count, and the app runs two: the POST wrote the job into one machine's
// heap, and the poll that followed could be routed to the other, which
// answered 404. Shared state is the only thing both can see.
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

// Long enough for a finished job to be collected by the poll that follows it,
// short enough that abandoned rows don't accumulate. Swept on write rather
// than on a timer, so an idle machine schedules nothing.
const JOB_TTL_MS = 10 * 60 * 1000

async function sweep(db: Db): Promise<void> {
  await db.deleteMany(recommendationJobs, { where: lt('updated_at', Date.now() - JOB_TTL_MS) })
}

function parsePhases(raw: string): GenerationPhase[] {
  const phases = raw.split(',').filter((phase): phase is GenerationPhase => phase in PHASE_LABELS)
  return phases.length > 0 ? phases : PHASE_ORDER
}

function toJob(row: RecommendationJob): GenerationJob {
  return {
    userId: row.user_id,
    phases: parsePhases(row.phases),
    phase: (row.phase in PHASE_LABELS ? row.phase : 'profiles') as GenerationPhase,
    runId: row.run_id ?? undefined,
    prunedOldestRun: row.pruned_oldest_run === 1,
    error: row.error ?? undefined,
    startedAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export async function createJob(
  db: Db,
  userId: number,
  options: { withLengthCheck: boolean },
): Promise<string> {
  await sweep(db)

  const id = crypto.randomUUID()
  const now = Date.now()
  const phases = options.withLengthCheck ? PHASE_ORDER : PHASE_ORDER.filter((phase) => phase !== 'lengths')

  await db.create(recommendationJobs, {
    id,
    user_id: userId,
    phases: phases.join(','),
    phase: 'profiles',
    pruned_oldest_run: 0,
    created_at: now,
    updated_at: now,
  })

  return id
}

export async function setPhase(db: Db, jobId: string, phase: GenerationPhase): Promise<void> {
  await db.updateMany(recommendationJobs, { phase, updated_at: Date.now() }, { where: { id: jobId } })
}

export async function completeJob(
  db: Db,
  jobId: string,
  runId: number,
  prunedOldestRun: boolean,
): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { run_id: runId, pruned_oldest_run: prunedOldestRun ? 1 : 0, updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

export async function failJob(db: Db, jobId: string, error: string): Promise<void> {
  await db.updateMany(recommendationJobs, { error, updated_at: Date.now() }, { where: { id: jobId } })
}

// Scoped by user: a job id is a bearer token otherwise, and someone else's
// progress is nobody's business.
export async function getJob(db: Db, jobId: string, userId: number): Promise<GenerationJob | null> {
  const row = await db.findOne(recommendationJobs, { where: { id: jobId, user_id: userId } })
  return row ? toJob(row) : null
}
