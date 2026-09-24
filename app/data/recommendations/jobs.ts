import { lt } from 'remix/data-table'

import { pool, type Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import { genreMissNeedsLookup } from './matching.ts'
import { recommendationJobs, type RecommendationJob } from '../schema.ts'
import type { RunTimings } from './timings.ts'

// In the database, not process memory: the POST and the poll that follows it can
// land on different machines.
export type GenerationPhase =
  | 'profiles'
  | 'picks'
  | 'matching'
  | 'genres'
  | 'lengths'
  | 'verifying'
  | 'saving'

// One per real await in generateRecommendations — adding a stage there means
// adding it here too.
export const PHASE_LABELS: Record<GenerationPhase, string> = {
  profiles: 'Reading what everyone has logged…',
  picks: 'Choosing picks…',
  matching: 'Looking each one up…',
  genres: 'Checking genres…',
  lengths: 'Checking lengths…',
  verifying: 'Making sure they match…',
  saving: 'Saving your picks…',
}

export const PHASE_ORDER: GenerationPhase[] = [
  'profiles',
  'picks',
  'matching',
  'genres',
  'lengths',
  'verifying',
  'saving',
]

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationJob {
  userId: number
  status: JobStatus
  queuedAhead?: number
  // Only the stages this run will hit — the genre and length checks each run
  // only when their lever is set, and the genre one only when it costs lookups.
  phases: GenerationPhase[]
  phase: GenerationPhase
  runId?: number
  // Set in run_id's place when the catalog wouldn't answer and the model's picks
  // were kept unconfirmed.
  unconfirmedRunId?: number
  prunedOldestRun?: boolean
  error?: string
  startedAt: number
  updatedAt: number
}

// Long enough for the poll that follows a finish to still find it.
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
    unconfirmedRunId: row.unconfirmed_run_id ?? undefined,
    prunedOldestRun: row.pruned_oldest_run === 1,
    error: row.error ?? undefined,
    startedAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export interface JobParams {
  memberIds: number[]
  mediaType: string
  filters: Record<string, unknown>
  sourceTypes: string[]
  name?: string
  // An "I'm feeling lucky" run. It queues, claims, beats and resumes exactly
  // like any other — only what comes out the far end differs, so this rides
  // along in the params rather than splitting the queue.
  lucky?: boolean
}

// The stages a run with these params will actually reach, in order.
//
// Read from the params rather than passed alongside them: a caller computing this
// and a run entering the stages are two statements of one fact, and the run is the
// one that can't be wrong. generateRecommendations asks this too, so a stage it
// enters is a stage the progress list already holds — a phase missing from that
// list reads as a bar that has stalled.
//
// The genre check is a stage only where it costs a round of lookups. Everywhere
// else the genre is read off the search hit inside `matching`, which is already
// its own stage.
export function phasesFor(params: {
  mediaType: string
  filters: { genre?: unknown; length?: unknown }
}): GenerationPhase[] {
  const skipped = new Set<GenerationPhase>()
  if (params.filters.genre == null || !genreMissNeedsLookup(params.mediaType as MediaType))
    skipped.add('genres')
  if (params.filters.length == null) skipped.add('lengths')
  return PHASE_ORDER.filter((phase) => !skipped.has(phase))
}

// `active_job` when the user already has one queued or running.
export type EnqueueJobResult = { ok: true; jobId: string } | { ok: false; reason: 'active_job' }

// The insert is the check. `on conflict do nothing` against the partial unique
// index (see the 20260816120000 migration) is what makes one-per-user hold under
// concurrent requests — reading first and inserting after leaves a window two
// requests can both pass through.
export async function enqueueJob(db: Db, userId: number, params: JobParams): Promise<EnqueueJobResult> {
  await sweep(db)

  const id = crypto.randomUUID()
  const now = Date.now()
  const phases = phasesFor(params)

  const { rows } = await pool.query<{ id: string }>(
    `insert into recommendation_jobs
       (id, user_id, status, params, attempts, phases, phase, pruned_oldest_run, created_at, updated_at)
     values ($1, $2, 'queued', $3, 0, $4, 'profiles', 0, $5, $5)
     on conflict (user_id) where status in ('queued', 'running') do nothing
     returning id`,
    [id, userId, JSON.stringify(params), phases.join(','), now],
  )

  if (rows.length === 0) return { ok: false, reason: 'active_job' }
  return { ok: true, jobId: rows[0].id }
}

export async function setPhase(db: Db, jobId: string, phase: GenerationPhase): Promise<void> {
  // claimed_at doubles as a heartbeat — without it the sweep reclaims a job
  // that is still reporting stages.
  await db.updateMany(
    recommendationJobs,
    { phase, claimed_at: Date.now(), updated_at: Date.now() },
    { where: { id: jobId } },
  )
}

// Scoped to running rows, so a beat landing after the job stopped can't revive a
// claim on something finished, failed, or already back in the queue.
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

// What a finished job points at. A run, or — when the catalog wouldn't answer and
// the model's own picks were kept instead — an unconfirmed one.
export type JobTarget =
  | { kind: 'run'; runId: number; prunedOldestRun: boolean }
  | { kind: 'unconfirmed'; unconfirmedRunId: number }

export async function completeJob(db: Db, jobId: string, target: JobTarget): Promise<void> {
  const columns =
    target.kind === 'run'
      ? { run_id: target.runId, pruned_oldest_run: target.prunedOldestRun ? 1 : 0 }
      : { unconfirmed_run_id: target.unconfirmedRunId }

  await db.updateMany(
    recommendationJobs,
    { status: 'done', ...columns, updated_at: Date.now() },
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

  // Running rows count too, or this reports "0 ahead" with four runs in flight.
  const { rows } = await pool.query<{ ahead: string }>(
    `select count(*)::text as ahead from recommendation_jobs
      where status = 'running' or (status = 'queued' and created_at < $1)`,
    [row.created_at],
  )
  return { ...job, queuedAhead: Number(rows[0]?.ahead ?? 0) }
}

// How long a claim survives without a beat. A measure of silence, not slowness:
// a worker beats while it works (touchJobClaim), so this must not be read as a
// bound on how long a stage may legitimately take.
export const CLAIM_STALE_MS = 3 * 60 * 1000

// Shared with the worker, which spends them on a catalog that won't answer before
// it gives up and keeps what the model said.
export const MAX_ATTEMPTS = 3

// A null claim is deliberately not stale — `claimed_at is not null`, never
// coalesce(claimed_at, 0). During a rolling deploy that would let a new-release
// machine seize a row written by the previous release and run it with nothing to
// run. Unrecognised rows are left to the TTL sweep.
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
  queuedMs: number
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
