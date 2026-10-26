// Drains staged imports waiting to be matched.
//
// Deliberately narrower than the recommendation worker: an import is one long
// stretch of catalog lookups with no model calls behind it, so it needs a claim,
// a heartbeat and a failure path, but not phases or checkpoints. Claiming uses
// `skip locked`, so running this on every machine is safe — they take different
// batches rather than racing for one.

import { db } from '../db.ts'
import type { ImportBatch } from '../schema.ts'
import { claimBatch, failBatch, touchClaim, CLAIM_STALE_MS } from './batches.ts'
import { matchBatch } from './matcher.ts'
import { logger } from '../../log.ts'

const log = logger('import')

const IDLE_POLL_MS = 2000

// While the database can't be reached every poll fails the same way, and at
// 2s a time the stack traces bury everything else in `fly logs`. Failures
// double the wait up to a minute, and a success drops straight back to idle.
const MAX_BACKOFF_MS = 60_000

export function pollDelay(failures: number): number {
  if (failures <= 0) return IDLE_POLL_MS
  return Math.min(IDLE_POLL_MS * 2 ** failures, MAX_BACKOFF_MS)
}

// Several beats inside the staleness window, since a claim only needs one of
// them to have landed.
const HEARTBEAT_MS = Math.floor(CLAIM_STALE_MS / 6)

export interface ImportWorker {
  stop: () => void
  tick: () => Promise<void>
  busy: () => boolean
}

export function startImportWorker(): ImportWorker {
  // One batch at a time per machine. Matching already fans out to the catalog's
  // concurrency ceiling internally, so a second in-flight batch would only make
  // both of them slower.
  let running = false
  let stopped = false
  let failures = 0
  let timer: NodeJS.Timeout | null = null

  async function run(batch: ImportBatch): Promise<void> {
    // On a timer rather than per row: matching a large batch can outlast the
    // staleness window between writes, and without a beat a live import would
    // be declared dead and handed to a second machine.
    const heartbeat = setInterval(() => {
      void touchClaim(db, batch.id).catch(() => {})
    }, HEARTBEAT_MS)

    try {
      await matchBatch(db, batch)
    } catch (error) {
      // Recorded on the batch rather than thrown away, so the page can say what
      // went wrong instead of spinning on "matching" forever.
      await failBatch(db, batch.id, error instanceof Error ? error.message : 'Matching failed.').catch(
        () => {},
      )
    } finally {
      clearInterval(heartbeat)
    }
  }

  async function tick(): Promise<void> {
    if (stopped || running) return

    const batch = await claimBatch(db)
    if (!batch) return

    running = true
    try {
      await run(batch)
    } finally {
      running = false
    }
  }

  // The full error once, when an outage starts; after that a line per retry, so
  // the log still shows it is ongoing without repeating the same trace.
  async function poll(): Promise<void> {
    try {
      await tick()
      if (failures > 0) log.info(`worker recovered after ${failures} failed ticks`)
      failures = 0
    } catch (error) {
      failures++
      const retry = `retrying in ${pollDelay(failures) / 1000}s`
      if (failures === 1) log.error(`worker tick failed, ${retry}`, error)
      else log.warn(`worker tick failed ${failures} times in a row, ${retry}: ${errorSummary(error)}`)
    }
  }

  function schedule(): void {
    timer = setTimeout(async () => {
      await poll()
      if (!stopped) schedule()
    }, pollDelay(failures))
  }

  schedule()

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
    tick,
    busy: () => running,
  }
}

// pg's connect failures are AggregateErrors with an empty message, one inner
// error per address tried; the code is what says what went wrong.
function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = (error as { code?: unknown }).code
  return [code, error.message].filter(Boolean).join(' ') || error.name
}
