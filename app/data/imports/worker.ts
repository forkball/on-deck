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

const IDLE_POLL_MS = 2000

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
  let timer: NodeJS.Timeout | null = setInterval(() => {
    void tick().catch((error) => console.error('import worker', error))
  }, IDLE_POLL_MS)

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
      await failBatch(db, batch.id, error instanceof Error ? error.message : 'Matching failed.').catch(() => {})
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

  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
    tick,
    busy: () => running,
  }
}
