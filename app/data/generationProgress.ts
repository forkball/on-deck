import { lt } from 'remix/data-table'

import { pool, type Db } from './db.ts'
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

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationJob {
  userId: number
  status: JobStatus
  // Position in line when queued; 0 once running.
  queuedAhead?: number
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
    status: (row.status as JobStatus) ?? 'running',
    phases: parsePhases(row.phases),
    phase: (row.phase in PHASE_LABELS ? row.phase : 'profiles') as GenerationPhase,
    runId: row.run_id ?? undefined,
    prunedOldestRun: row.pruned_oldest_run === 1,
    error: row.error ?? undefined,
    startedAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

// Everything a worker needs to run a job it never received.
export interface JobParams {
  memberIds: number[]
  mediaType: string
  filters: Record<string, unknown>
  sourceTypes: string[]
  name?: string
}

export async function enqueueJob(
  db: Db,
  userId: number,
  params: JobParams,
  options: { withLengthCheck: boolean },
): Promise<string> {
  await sweep(db)

  const id = crypto.randomUUID()
  const now = Date.now()
  const phases = options.withLengthCheck ? PHASE_ORDER : PHASE_ORDER.filter((phase) => phase !== 'lengths')

  await db.create(recommendationJobs, {
    id,
    user_id: userId,
    status: 'queued',
    params: JSON.stringify(params),
    attempts: 0,
    phases: phases.join(','),
    phase: 'profiles',
    pruned_oldest_run: 0,
    created_at: now,
    updated_at: now,
  })

  return id
}

// One in flight per person, so nobody can fill the queue on their own.
export async function hasActiveJob(db: Db, userId: number): Promise<boolean> {
  const rows = await db.findMany(recommendationJobs, { where: { user_id: userId } })
  return rows.some((row) => row.status === 'queued' || row.status === 'running')
}

export async function setPhase(db: Db, jobId: string, phase: GenerationPhase): Promise<void> {
  // claimed_at doubles as a heartbeat: a job reporting stages is alive, so
  // the staleness sweep must not reclaim it out from under its worker.
  await db.updateMany(
    recommendationJobs,
    { phase, claimed_at: Date.now(), updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

export async function saveCheckpoint(db: Db, jobId: string, checkpoint: unknown): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { checkpoint: JSON.stringify(checkpoint), updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

export async function completeJob(
  db: Db,
  jobId: string,
  runId: number,
  prunedOldestRun: boolean,
): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { status: 'done', run_id: runId, pruned_oldest_run: prunedOldestRun ? 1 : 0, updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

export async function failJob(db: Db, jobId: string, error: string): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { status: 'failed', error, updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

// Returns a job to the queue so another attempt can resume it from its
// checkpoint. Used when a run is interrupted rather than genuinely broken.
export async function requeueJob(db: Db, jobId: string): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { status: 'queued', claimed_at: undefined, updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

// Scoped by user: a job id is a bearer token otherwise, and someone else's
// progress is nobody's business.
export async function getJob(db: Db, jobId: string, userId: number): Promise<GenerationJob | null> {
  const row = await db.findOne(recommendationJobs, { where: { id: jobId, user_id: userId } })
  if (!row) return null

  const job = toJob(row)
  if (job.status !== 'queued') return job

  // Everything genuinely ahead of this one: older queued jobs *and* whatever
  // is already running. Counting only the queued ones reported "0 ahead"
  // while four runs were in progress in front of it, which is true of the
  // queue and useless to the person reading it.
  const { rows } = await pool.query<{ ahead: string }>(
    `select count(*)::text as ahead from recommendation_jobs
      where status = 'running' or (status = 'queued' and created_at < $1)`,
    [row.created_at],
  )
  return { ...job, queuedAhead: Number(rows[0]?.ahead ?? 0) }
}

// How long a claim may go without a heartbeat before another worker may take
// the job. Comfortably longer than the slowest stage — the model calls are
// tens of seconds — so a working run is never stolen mid-flight.
const CLAIM_STALE_MS = 3 * 60 * 1000

// Retried twice, then left failed. An interrupted run resumes cheaply from its
// checkpoint, but a genuinely broken one must not cycle forever.
const MAX_ATTEMPTS = 3

// Returns abandoned work to the queue. A running job whose heartbeat stopped
// means the machine holding it died — a deploy, an OOM, or a stop under
// scale-to-zero.
export async function requeueStaleJobs(db: Db): Promise<number> {
  const { rowCount } = await pool.query(
    `update recommendation_jobs
        set status = case when attempts >= $2 then 'failed' else 'queued' end,
            error  = case when attempts >= $2 then coalesce(error, 'Generating stopped partway too many times.') else error end,
            claimed_at = null,
            updated_at = $3
      where status = 'running' and coalesce(claimed_at, 0) < $1`,
    [Date.now() - CLAIM_STALE_MS, MAX_ATTEMPTS, Date.now()],
  )
  return rowCount ?? 0
}

export interface ClaimedJob {
  id: string
  userId: number
  params: JobParams
  checkpoint: unknown
}

// Claims up to `limit` queued jobs for this process.
//
// SKIP LOCKED is what makes two machines safe: neither waits on the other's
// locked rows, and neither can be handed the same job. Without it both would
// serialise on the same head-of-queue row and one would take work the other
// had already started.
export async function claimJobs(db: Db, limit: number): Promise<ClaimedJob[]> {
  if (limit <= 0) return []

  const now = Date.now()
  const { rows } = await pool.query<{
    id: string
    user_id: number
    params: string
    checkpoint: string | null
  }>(
    `update recommendation_jobs
        set status = 'running', claimed_at = $1, attempts = attempts + 1, updated_at = $1
      where id in (
        select id from recommendation_jobs
         where status = 'queued'
         order by created_at
         limit $2
         for update skip locked
      )
      returning id, user_id, params, checkpoint`,
    [now, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    params: JSON.parse(row.params) as JobParams,
    checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : {},
  }))
}
