import { lt } from 'remix/data-table'

import { pool, type Db } from '../db.ts'
import { recommendationJobs, type RecommendationJob } from '../schema.ts'
import type { RunTimings } from './timings.ts'

// Live progress for an in-flight run. Generating takes tens of seconds, so the
// request hands back a job id and the wait page polls the stage from here.
//
// In the database, not process memory: the app runs two machines, so the POST
// and the poll that follows it can land on different ones.
export type GenerationPhase = 'profiles' | 'picks' | 'matching' | 'lengths' | 'verifying' | 'saving'

// Each corresponds to a real await in generateRecommendations — adding a stage
// there means adding it here too.
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
  // Only the stages this run will actually hit — the length check happens only
  // when a length lever is set, and showing a stage that never runs is
  // invented progress.
  phases: GenerationPhase[]
  phase: GenerationPhase
  // Set once finished; the client navigates here.
  runId?: number
  prunedOldestRun?: boolean
  error?: string
  startedAt: number
  updatedAt: number
}

// Long enough for the poll that follows a finish to still find it. Swept on
// write rather than on a timer, so an idle machine schedules nothing.
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
  // claimed_at doubles as a heartbeat, so the staleness sweep won't reclaim a
  // job that's still reporting stages.
  await db.updateMany(
    recommendationJobs,
    { phase, claimed_at: Date.now(), updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

// The same heartbeat, without a stage to report — see HEARTBEAT_MS in worker.ts
// for why a stage isn't enough on its own.
//
// Scoped to running rows so a beat that lands after the job stopped can't
// revive a claim on something finished, failed, or already handed back to the
// queue.
export async function touchJobClaim(db: Db, jobId: string): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { claimed_at: Date.now(), updated_at: Date.now() },
    { where: { id: jobId, status: 'running' } },
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

// For an interrupted run, not a broken one: the next attempt resumes from the
// checkpoint.
export async function requeueJob(db: Db, jobId: string): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { status: 'queued', claimed_at: undefined, updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

// Scoped by user — a job id would otherwise be a bearer token.
export async function getJob(db: Db, jobId: string, userId: number): Promise<GenerationJob | null> {
  const row = await db.findOne(recommendationJobs, { where: { id: jobId, user_id: userId } })
  if (!row) return null

  const job = toJob(row)
  if (job.status !== 'queued') return job

  // Older queued jobs *and* whatever is already running — counting only the
  // queued ones reports "0 ahead" with four runs in progress.
  const { rows } = await pool.query<{ ahead: string }>(
    `select count(*)::text as ahead from recommendation_jobs
      where status = 'running' or (status = 'queued' and created_at < $1)`,
    [row.created_at],
  )
  return { ...job, queuedAhead: Number(rows[0]?.ahead ?? 0) }
}

// How long a claim survives without a beat. A measure of silence, not of
// slowness: a worker beats while it works (touchJobClaim, HEARTBEAT_MS), so
// nothing for three minutes means the machine is gone — however long the stage
// it was in would legitimately have taken.
export const CLAIM_STALE_MS = 3 * 60 * 1000

// Retried twice, then left failed, so a genuinely broken run can't cycle.
const MAX_ATTEMPTS = 3

// A running job whose heartbeat stopped means its machine died.
//
// A null claim is deliberately not stale — `claimed_at is not null`, never
// coalesce(claimed_at, 0). During a rolling deploy that would let a new-release
// machine seize a row written by the previous release and run it with nothing
// to run. Unrecognised rows are left to the TTL sweep.
export async function requeueStaleJobs(db: Db): Promise<number> {
  const { rowCount } = await pool.query(
    `update recommendation_jobs
        set status = case when attempts >= $2 then 'failed' else 'queued' end,
            error  = case when attempts >= $2 then coalesce(error, 'Generating stopped partway too many times.') else error end,
            claimed_at = null,
            updated_at = $3
      where status = 'running' and claimed_at is not null and claimed_at < $1`,
    [Date.now() - CLAIM_STALE_MS, MAX_ATTEMPTS, Date.now()],
  )
  return rowCount ?? 0
}

export interface ClaimedJob {
  id: string
  userId: number
  params: JobParams
  checkpoint: unknown
  // How long this sat before a worker picked it up. Measured at the claim
  // rather than at the start of generation, so it stays queue wait and doesn't
  // absorb whatever the worker does before it starts.
  queuedMs: number
  // Post-increment, so the first run of a job reports 1.
  attempt: number
}

// SKIP LOCKED is what makes two machines safe: without it both serialise on the
// same head-of-queue row and one takes work the other already started.
export async function claimJobs(db: Db, limit: number): Promise<ClaimedJob[]> {
  if (limit <= 0) return []

  const now = Date.now()
  const { rows } = await pool.query<{
    id: string
    user_id: number
    params: string
    checkpoint: string | null
    created_at: number
    attempts: number
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
      returning id, user_id, params, checkpoint, created_at, attempts`,
    [now, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    params: JSON.parse(row.params) as JobParams,
    checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : {},
    // A requeued job's wait is measured from when it was first asked for, not
    // from the requeue: that's the wait the person actually sat through.
    queuedMs: Math.max(0, now - Number(row.created_at)),
    attempt: row.attempts,
  }))
}

export async function saveJobTimings(db: Db, jobId: string, timings: RunTimings): Promise<void> {
  await db.updateMany(
    recommendationJobs,
    { timings: JSON.stringify(timings), updated_at: Date.now() },
    { where: { id: jobId } },
  )
}
