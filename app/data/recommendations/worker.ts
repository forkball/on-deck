import { db } from '../db.ts'
import {
  claimJobs,
  completeJob,
  failJob,
  requeueStaleJobs,
  saveCheckpoint,
  setPhase,
  type ClaimedJob,
} from './jobs.ts'
import { generateRecommendations, type GenerationCheckpoint } from './generate.ts'
import type { MediaType } from '../mediaItems.ts'
import type { RecommendationFilters } from './picks.ts'

// Drains the recommendation queue.
//
// Generation used to start the moment a request arrived, with nothing bounding
// how many ran at once. At any real concurrency that is what breaks first:
// every in-flight run holds a user's whole log in memory on a 512MB machine,
// and each one fans out into model and catalog calls that have their own
// ceilings. This puts a fixed number of slots in front of all of it.
//
// Deliberately bounded rather than elastic. The limits that matter here belong
// to services outside this app, so adding workers past a point makes things
// worse, not faster.
const DEFAULT_SLOTS = 2

// Long enough that an empty queue costs almost nothing, short enough that a
// waiting person doesn't notice the gap.
const IDLE_POLL_MS = 2000

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
    try {
      const { memberIds, mediaType, filters, sourceTypes, name } = job.params

      // A job whose params can't be read is not runnable, and guessing at
      // defaults would silently generate something nobody asked for. Failing
      // here says so; without this the missing field surfaced as "Cannot read
      // properties of undefined" from deep inside generation.
      if (!Array.isArray(memberIds) || memberIds.length === 0 || !mediaType) {
        await failJob(db, job.id, "This run's settings couldn't be read. Try generating it again.")
        return
      }

      const { runId, prunedOldestRun } = await generateRecommendations(
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
      )

      await completeJob(db, job.id, runId, prunedOldestRun)
    } catch (error) {
      // Left failed rather than requeued: this ran to an actual error, so
      // retrying immediately would just reproduce it. Jobs that were
      // *interrupted* never reach here — their machine died — and are
      // recovered by the staleness sweep instead.
      await failJob(
        db,
        job.id,
        error instanceof Error ? error.message : 'Generating failed. Try again.',
      ).catch(() => {})
    } finally {
      running--
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return

    try {
      await requeueStaleJobs(db)
      const jobs = await claimJobs(db, slots - running)
      // Not awaited: each run is long, and the loop has to stay responsive to
      // free slots as they finish.
      for (const job of jobs) void run(job)
    } catch {
      // A failed tick is not fatal — the next one retries. Swallowing it keeps
      // a transient database blip from killing the loop for the process.
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
      // In-flight work is deliberately not awaited. Fly's shutdown grace is
      // far shorter than a run, so anything mid-flight is left to the
      // staleness sweep, which returns it to the queue to resume from its
      // checkpoint on another machine.
    },
    tick,
    inFlight: () => running,
  }
}
