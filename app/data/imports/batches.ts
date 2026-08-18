// Persistence for a staged import: the batch, its rows, and the decisions
// review writes onto them. The rules live in classify.ts and review.ts; this
// module only moves them in and out of the database.

import { and, eq, inList } from 'remix/data-table'

import { pool, type Db } from '../db.ts'
import { getCatalogProvider, upsertCatalogItem } from '../catalog/provider.ts'
import { logInteraction, type MediaType } from '../mediaItems.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import { importBatches, importRows, mediaItems, userMediaInteractions, type ImportBatch, type ImportRow } from '../schema.ts'
import type { ConflictChoice, RowState } from './classify.ts'
import {
  buildReview,
  type CatalogEntry,
  type ExistingEntry,
  type ReviewModel,
  type StagedRow,
} from './review.ts'

export interface ParsedRow {
  rowIndex: number
  title: string
  year: number | null
  rating: number | null
  disliked?: boolean | null
  notes?: string | null
  consumedAt: number | null
}

export async function createBatch(
  db: Db,
  userId: number,
  mediaType: MediaType,
  source: string,
  rows: ParsedRow[],
): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()

  await db.create(importBatches, {
    id,
    user_id: userId,
    media_type: mediaType,
    source,
    status: 'matching',
    total_rows: rows.length,
    matched_rows: 0,
    conflict_choice: 'keep',
    created_at: now,
    updated_at: now,
  })

  // One statement rather than a create() per row: a 400-row export is 400 round
  // trips to Supabase otherwise, which is most of the time the upload spends.
  if (rows.length > 0) {
    const values: unknown[] = []
    const tuples = rows.map((row, i) => {
      const base = i * 9
      values.push(id, row.rowIndex, row.title, row.year, row.rating, row.notes ?? null, row.consumedAt, now, now)
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
    })

    await pool.query(
      `insert into import_rows
         (batch_id, row_index, raw_title, raw_year, rating, notes, consumed_at, created_at, updated_at)
       values ${tuples.join(', ')}`,
      values,
    )
  }

  return id
}

// Long enough that a slow catalog can't get a live batch declared dead, short
// enough that a machine lost mid-import is picked up rather than stranded.
export const CLAIM_STALE_MS = 2 * 60 * 1000

// `for update skip locked` is what lets several machines drain the queue
// without racing for the same batch — the same approach the recommendation
// worker takes.
export async function claimBatch(db: Db): Promise<ImportBatch | null> {
  const cutoff = Date.now() - CLAIM_STALE_MS

  const { rows } = await pool.query<{ id: string }>(
    `update import_batches
        set claimed_at = $1, updated_at = $1
      where id = (
        select id from import_batches
         where status = 'matching' and (claimed_at is null or claimed_at < $2)
         order by created_at
         for update skip locked
         limit 1
      )
      returning id`,
    [Date.now(), cutoff],
  )

  if (rows.length === 0) return null
  return (await db.find(importBatches, rows[0].id)) ?? null
}

export async function touchClaim(db: Db, batchId: string): Promise<void> {
  const now = Date.now()
  await db.update(importBatches, batchId, { claimed_at: now, updated_at: now })
}

export async function recordMatch(
  db: Db,
  rowId: number,
  result: { state: RowState; reason: string | null; yearDelta: number | null; externalId: string | null; mediaItemId: number | null },
): Promise<void> {
  await db.update(importRows, rowId, {
    state: result.state,
    reason: result.reason ?? undefined,
    year_delta: result.yearDelta,
    matched_external_id: result.externalId ?? undefined,
    media_item_id: result.mediaItemId,
    updated_at: Date.now(),
  })
}

export async function setMatchedCount(db: Db, batchId: string, matched: number): Promise<void> {
  await db.update(importBatches, batchId, { matched_rows: matched, claimed_at: Date.now(), updated_at: Date.now() })
}

export async function finishMatching(db: Db, batchId: string): Promise<void> {
  await db.update(importBatches, batchId, { status: 'review', claimed_at: undefined, updated_at: Date.now() })
}

export async function failBatch(db: Db, batchId: string, message: string): Promise<void> {
  await db.update(importBatches, batchId, {
    status: 'failed',
    error: message,
    claimed_at: undefined,
    updated_at: Date.now(),
  })
}

// Scoped by user on every read: a batch id is a UUID, but guessing is not the
// only way one leaks, and someone else's import is nobody's business.
export async function loadBatch(db: Db, batchId: string, userId: number): Promise<ImportBatch | null> {
  const batch = await db.findOne(importBatches, { where: and(eq('id', batchId), eq('user_id', userId)) })
  return batch ?? null
}

export async function loadRows(db: Db, batchId: string): Promise<ImportRow[]> {
  return db.findMany(importRows, { where: { batch_id: batchId }, orderBy: ['row_index', 'asc'] })
}

function toStagedRow(row: ImportRow): StagedRow {
  return {
    id: row.id,
    rowIndex: row.row_index,
    title: row.raw_title,
    year: row.raw_year ?? null,
    rating: row.rating ?? null,
    disliked: row.disliked ?? null,
    notes: row.notes ?? null,
    consumedAt: row.consumed_at ?? null,
    state: row.state as StagedRow['state'],
    reason: (row.reason ?? null) as StagedRow['reason'],
    yearDelta: row.year_delta ?? null,
    mediaItemId: row.media_item_id ?? null,
  }
}

function toCatalogEntry(item: { id: number; title: string; metadata: unknown }): CatalogEntry {
  const { releaseYear, creator, posterUrl } = parseMediaMetadata(item.metadata)
  return { id: item.id, title: item.title, releaseYear: releaseYear ?? null, creator: creator ?? null, posterUrl: posterUrl ?? null }
}

export async function loadReview(db: Db, batch: ImportBatch): Promise<{ rows: ImportRow[]; model: ReviewModel }> {
  const rows = await loadRows(db, batch.id)
  const staged = rows.map(toStagedRow)

  const itemIds = [...new Set(staged.map((row) => row.mediaItemId).filter((id): id is number => id != null))]

  // Two batched reads rather than one per row — the review page for a 400-row
  // import would otherwise open 800 connections to render.
  const items = itemIds.length === 0 ? [] : await db.findMany(mediaItems, { where: inList('id', itemIds) })
  const interactions =
    itemIds.length === 0
      ? []
      : await db.findMany(userMediaInteractions, {
          where: and(eq('user_id', batch.user_id), inList('media_item_id', itemIds)),
        })

  const itemMap = new Map<number, CatalogEntry>(items.map((item) => [item.id, toCatalogEntry(item)]))
  const existing = new Map<number, ExistingEntry>(
    interactions.map((row) => [
      row.media_item_id,
      {
        mediaItemId: row.media_item_id,
        rating: row.rating ?? null,
        disliked: row.disliked ?? null,
        consumedAt: row.consumed_at ?? null,
        notes: row.notes ?? null,
      },
    ]),
  )

  return { rows, model: buildReview(staged, itemMap, existing, batch.conflict_choice as ConflictChoice) }
}

async function ownedRow(db: Db, batch: ImportBatch, rowId: number): Promise<ImportRow | null> {
  const row = await db.findOne(importRows, { where: and(eq('id', rowId), eq('batch_id', batch.id)) })
  return row ?? null
}

// Marks an uncertain match as read and correct. It was already going to save —
// this only clears it off the page.
export async function confirmRow(db: Db, batch: ImportBatch, rowId: number): Promise<boolean> {
  const row = await ownedRow(db, batch, rowId)
  if (!row) return false

  await db.update(importRows, row.id, { state: 'confirmed', updated_at: Date.now() })
  return true
}

// Resolves a conflict in favour of the log. Distinct from skipping, which is
// how a row is thrown away — this one is a row that was already there.
export async function keepRow(db: Db, batch: ImportBatch, rowId: number): Promise<boolean> {
  const row = await ownedRow(db, batch, rowId)
  if (!row) return false

  await db.update(importRows, row.id, { state: 'kept', updated_at: Date.now() })
  return true
}

export async function skipRow(db: Db, batch: ImportBatch, rowId: number): Promise<boolean> {
  const row = await ownedRow(db, batch, rowId)
  if (!row) return false

  await db.update(importRows, row.id, { state: 'skipped', updated_at: Date.now() })
  return true
}

export type RepointResult = { ok: true } | { ok: false; error: string }

// Points a staged row at a different catalog entry. Simpler than
// rematchMediaItem, which has to merge interactions and delete the loser: a
// staged row owns no media_items row of its own, so this only changes which one
// it refers to, and nothing is committed until save.
export async function repointRow(
  db: Db,
  batch: ImportBatch,
  rowId: number,
  externalId: string,
): Promise<RepointResult> {
  const row = await ownedRow(db, batch, rowId)
  if (!row) return { ok: false, error: 'That row is not part of this import.' }

  const mediaType = batch.media_type as MediaType
  const provider = getCatalogProvider(mediaType)
  const parsed = provider.parseExternalId(externalId) ?? externalId

  const detail = await provider.getById(parsed)
  if (!detail) return { ok: false, error: provider.lookupFailedError }

  const item = await upsertCatalogItem(db, mediaType, detail)

  await db.update(importRows, row.id, {
    // Confirmed rather than re-classified: a person picking a film off the
    // shelf is better evidence than the year arithmetic that flagged it.
    state: 'confirmed',
    reason: undefined,
    year_delta: null,
    matched_external_id: item.external_id,
    media_item_id: item.id,
    updated_at: Date.now(),
  })

  return { ok: true }
}

// The long tail of a large import, cleared in one click. Bounded to the rows
// the page offered — anything wider would sweep up matches nobody vouched for.
export async function acceptBulk(db: Db, batch: ImportBatch, rowIds: number[]): Promise<number> {
  if (rowIds.length === 0) return 0

  await db.updateMany(
    importRows,
    { state: 'confirmed', updated_at: Date.now() },
    { where: and(eq('batch_id', batch.id), inList('id', rowIds)) },
  )

  return rowIds.length
}

export async function setConflictChoice(db: Db, batchId: string, choice: ConflictChoice): Promise<void> {
  await db.update(importBatches, batchId, { conflict_choice: choice, updated_at: Date.now() })
}

export interface SaveResult {
  saved: number
  unchanged: number
  leftOut: number
}

// The only place an import touches user_media_interactions. Everything before
// this is staging, which is what makes every decision on the review page
// reversible right up to the moment this runs.
export async function saveBatch(db: Db, batch: ImportBatch): Promise<SaveResult> {
  const { rows, model } = await loadReview(db, batch)
  await db.update(importBatches, batch.id, { status: 'saving', updated_at: Date.now() })

  const byId = new Map(rows.map((row) => [row.id, row]))
  const conflicted = new Set(model.conflicts.map(({ row }) => row.id))
  const held = new Set<number>()
  for (const { verdict } of model.duplicates) {
    held.add(verdict.kind === 'different_films' ? verdict.move.id : verdict.drop.id)
  }

  const writable: ImportRow[] = []

  for (const row of rows) {
    if (row.state === 'skipped' || row.state === 'kept' || row.state === 'not_found' || row.state === 'pending') continue
    if (row.media_item_id == null) continue
    if (held.has(row.id)) continue
    // A conflict is only written when the batch says take it, or this row was
    // confirmed by hand — which beats the batch default.
    if (conflicted.has(row.id) && batch.conflict_choice === 'keep' && row.state !== 'confirmed') continue
    writable.push(row)
  }

  for (const row of writable) {
    await logInteraction(db, batch.user_id, row.media_item_id as number, {
      status: 'consumed',
      // Omitted, not null: a blank rating cell is an absence of information,
      // not an instruction to forget what is already there.
      rating: row.rating ?? undefined,
      notes: row.notes ?? null,
      consumedAt: row.consumed_at ?? undefined,
    })
  }

  const now = Date.now()
  await db.update(importBatches, batch.id, { status: 'done', completed_at: now, updated_at: now })

  return { saved: writable.length, unchanged: model.counts.unchanged, leftOut: model.counts.leftOut }
}

// Everything the person could still come back to, newest first.
export async function listBatches(db: Db, userId: number, limit = 10): Promise<ImportBatch[]> {
  return db.findMany(importBatches, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
    limit,
  })
}

// One unfinished import at a time, so a second upload can't quietly orphan the
// batch someone is halfway through reviewing.
export async function activeBatch(db: Db, userId: number, mediaType: MediaType): Promise<ImportBatch | null> {
  const batch = await db.findOne(importBatches, {
    where: and(eq('user_id', userId), eq('media_type', mediaType), inList('status', ['matching', 'review'])),
  })
  return batch ?? null
}

export { toStagedRow }
