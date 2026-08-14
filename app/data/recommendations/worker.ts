import { db } from '../db.ts'
import {
  CLAIM_STALE_MS,
  claimJobs,
  completeJob,
  failJob,
  requeueStaleJobs,
  saveCheckpoint,
  saveJobTimings,
  setPhase,
  touchJobClaim,
  type ClaimedJob,
} from './jobs.ts'
import { GenerationError } from './errors.ts'
import { generateRecommendations, type GenerationCheckpoint } from './generate.ts'
import type { MediaType } from '../mediaItems.ts'
import type { RecommendationFilters } from './picks.ts'
import { saveRunTimings } from './runs.ts'
import { startTimings, summarizeTimings, type RunTimings } from './timings.ts'

// Drains the recommendation queue through a fixed number of slots. Every
// in-flight run holds a user's whole log in memory on a 512MB machine and fans
// out into model and catalog calls with their own ceilings — and those ceilings
// belong to other services, so more workers past a point makes things worse.
const DEFAULT_SLOTS = 2

// Short enough that a waiting person doesn't notice the gap.
const IDLE_POLL_MS = 2000

// Derived rather than picked, so lowering the staleness window can't quietly
// leave the heartbeat too slow to keep up with it. Several beats per window,
// since a claim only needs one of them to have landed.
const HEARTBEAT_MS = Math.floor(CLAIM_STALE_MS / 6)

function slotCount(): number {
  const configured = Number(process.env.WORKER_SLOTS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SLOTS
}

export interface GenerationWorker {
  stop: () => void
  // Exposed for tests, which need to drive a tick rather than wait on a timer.
  tick: () => Promise<void>
  inFlight: () => number
}

export function startGenerationWorker(): GenerationWorker {
  const slots = slotCount()
  let running = 0
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  async function run(job: ClaimedJob): Promise<void> {
    running++
    // Started before the params check so a job that fails validation still
    // reports the queue wait it spent getting here.
    const timings = startTimings({ queuedMs: job.queuedMs, attempt: job.attempt })
    let runId: number | null = null

    // On a timer rather than per stage. A single stage can outlast the
    // staleness window — the picks call runs for as long as the model spends on
    // it, and its budget scales with the size of the group — so stages alone
    // would let a live job be declared dead and handed to a second worker.
    // Beating keeps CLAIM_STALE_MS meaning what it says: no beat, no machine.
    const heartbeat = setInterval(() => {
      void touchJobClaim(db, job.id).catch(() => {})
    }, HEARTBEAT_MS)

    try {
      const { memberIds, mediaType, filters, sourceTypes, name } = job.params

      // Guessing at defaults would silently generate something nobody asked for.
      if (!Array.isArray(memberIds) || memberIds.length === 0 || !mediaType) {
        await failJob(db, job.id, "This run's settings couldn't be read. Try generating it again.")
        return
      }

      const outcome = await timings.run(() =>
        generateRecommendations(
          db,
          job.userId,
          memberIds,
          filters as RecommendationFilters,
          mediaType as MediaType,
          sourceTypes as MediaType[],
          name,
          (phase) => void setPhase(db, job.id, phase).catch(() => {}),
          job.checkpoint as GenerationCheckpoint,
          (checkpoint) => void saveCheckpoint(db, job.id, checkpoint).catch(() => {}),
        ),
      )

      runId = outcome.runId
      await completeJob(db, job.id, outcome.runId, outcome.prunedOldestRun)
    } catch (error) {
      // An actual error, so retrying would reproduce it. Interrupted jobs never
      // reach here — their machine died — and the staleness sweep recovers them.
      //
      // Logged whatever it is: this is the only place the detail of a failed run
      // is kept, since it doesn't travel to the page.
      console.error(`[generation] job=${job.id} failed:`, error)

      // Only a message written for the person reaches them; everything else gets
      // the generic line. See errors.ts — silence is the safe default, so a new
      // throw downstream inherits it without knowing this exists.
      await failJob(
        db,
        job.id,
        error instanceof GenerationError ? error.message : 'Generating failed. Try again.',
      ).catch(() => {})
    } finally {
      clearInterval(heartbeat)
      running--
      // After the job is already marked done: a person waiting on the poll
      // shouldn't wait on bookkeeping, and a failed write here would otherwise
      // turn a finished run into a failed one.
      await recordTimings(job, runId, timings.finish()).catch(() => {})
    }
  }

  // The log line is the copy anyone actually reads — the stored rows are for
  // comparing runs against each other later, once there are enough to compare.
  async function recordTimings(job: ClaimedJob, runId: number | null, measured: RunTimings): Promise<void> {
    console.info(`[generation] job=${job.id} run=${runId ?? 'none'} ${summarizeTimings(measured)}`)
    await saveJobTimings(db, job.id, measured)
    if (runId != null) await saveRunTimings(db, runId, measured)
  }

  async function tick(): Promise<void> {
    if (stopped) return

    try {
      await requeueStaleJobs(db)
      const jobs = await claimJobs(db, slots - running)
      // Not awaited — the loop has to stay responsive as slots free up.
      for (const job of jobs) void run(job)
    } catch {
      // The next tick retries; a transient database blip shouldn't kill the loop.
    }
  }

  function schedule(): void {
    timer = setTimeout(async () => {
      await tick()
      if (!stopped) schedule()
    }, IDLE_POLL_MS)
  }

  schedule()

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      // Fly's shutdown grace is far shorter than a run, so in-flight work is
      // left to the staleness sweep to resume elsewhere from its checkpoint.
    },
    tick,
    inFlight: () => running,
  }
}
