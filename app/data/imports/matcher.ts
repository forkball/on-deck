// Looks every staged row up in the catalog, then resolves the batch as a whole.
//
// This is the phase that used to run inside the upload request. At the bound
// below, 400 rows is ~50 sequential rounds of one search plus a few database
// round trips — tens of seconds, which is survivable in a request but loses the
// whole import to any timeout, and gives the person nothing to come back to.

import { getCatalogProvider, upsertCatalogItem, type CatalogSearchResult } from '../catalog/provider.ts'
import type { Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import type { ImportBatch } from '../schema.ts'
import { finishMatching, loadRows, recordMatch, setMatchedCount, touchClaim } from './batches.ts'
import { runBounded } from './csv.ts'
import { resolveBatch, type MatchInput } from './resolve.ts'

// The same ceiling the in-request importer used. Raising it makes the catalog's
// rate limit the binding constraint rather than ours.
const CONCURRENCY = 8

// How often the row counter and the claim heartbeat are written. Per row would
// be a write per search; per batch would let a live import look dead.
const PROGRESS_STRIDE = 10

export async function matchBatch(db: Db, batch: ImportBatch): Promise<void> {
  const mediaType = batch.media_type as MediaType
  const provider = getCatalogProvider(mediaType)

  const rows = await loadRows(db, batch.id)
  const pending = rows.filter((row) => row.state === 'pending')

  const inputs: MatchInput[] = []
  // Keyed by external id so the full catalog result survives resolution —
  // resolveBatch only deals in the fields that decide a match, but upserting
  // needs everything the provider returned.
  const details = new Map<string, CatalogSearchResult>()
  let matched = rows.length - pending.length

  await runBounded(pending, CONCURRENCY, async (row) => {
    let results: CatalogSearchResult[] = []
    try {
      results = await provider.search(row.raw_title)
    } catch {
      // A single lookup failing is not the import failing: the row lands in
      // "couldn't find", where it can be searched for by hand.
      results = []
    }

    for (const result of results) details.set(result.externalId, result)
    inputs.push({ rowId: row.id, title: row.raw_title, year: row.raw_year ?? null, results })

    matched++
    if (matched % PROGRESS_STRIDE === 0) await setMatchedCount(db, batch.id, matched)
  })

  const outcomes = resolveBatch(inputs)

  // One upsert per distinct film rather than per row: an import of a series
  // resolves hundreds of rows onto far fewer catalog entries.
  const itemIds = new Map<string, number>()
  for (const outcome of outcomes) {
    if (!outcome.chosen || itemIds.has(outcome.chosen.externalId)) continue

    const detail = details.get(outcome.chosen.externalId)
    if (!detail) continue

    const item = await upsertCatalogItem(db, mediaType, detail)
    itemIds.set(outcome.chosen.externalId, item.id)
  }

  await touchClaim(db, batch.id)

  for (const outcome of outcomes) {
    const externalId = outcome.chosen?.externalId ?? null
    await recordMatch(db, outcome.rowId, {
      state: outcome.verdict.state,
      reason: outcome.verdict.reason,
      yearDelta: outcome.verdict.yearDelta,
      externalId,
      mediaItemId: externalId == null ? null : (itemIds.get(externalId) ?? null),
    })
  }

  await setMatchedCount(db, batch.id, rows.length)
  await finishMatching(db, batch.id)
}
