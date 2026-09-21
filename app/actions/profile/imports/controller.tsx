import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { getCatalogProvider } from '../../../data/catalog/provider.ts'
import {
  acceptBulk,
  confirmRow,
  keepRow,
  loadBatch,
  loadReview,
  repointRow,
  saveBatch,
  setConflictChoice,
  skipRow,
} from '../../../data/imports/batches.ts'
import { isBulkAcceptable } from '../../../data/imports/classify.ts'
import type { MediaType } from '../../../data/mediaItems.ts'
import type { ImportBatch, User } from '../../../data/schema.ts'
import { displayLabel } from '../../../data/users.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import type { ImportBatchContext, ImportRowContext } from '../../../middleware/context.ts'
import { routes } from '../../../routes.ts'
import { ImportMatchingPage } from './matching-page.tsx'
import { ImportReviewPage } from './review-page.tsx'

type Found = { ok: true; batch: ImportBatch; displayName: string } | { ok: false; response: Response }

// Every action starts here. loadBatch scopes by user, so a batch id in a URL is
// not on its own authority to read someone else's import.
async function findBatch(context: ImportBatchContext | ImportRowContext): Promise<Found> {
  const auth = context.get(Auth)

  const batch = await loadBatch(context.get(Database), context.params.batchId, auth.identity.id)
  if (!batch) return { ok: false, response: new Response('Not found', { status: 404 }) }

  return { ok: true, batch, displayName: displayLabel(auth.identity) }
}

function backToReview(batch: ImportBatch, error?: string): Response {
  const href = routes.profile.imports.review.href({ batchId: batch.id })
  return redirect(error ? `${href}?error=${encodeURIComponent(error)}` : href, 303)
}

export default createController(routes.profile.imports, {
  middleware: [requireAuth<User>()],
  actions: {
    // Where the upload lands. Redirects straight on to review once matching is
    // done, so the wait page is only ever seen while there is a wait.
    async show(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch, displayName } = found

      const partial = context.url.searchParams.get('partial') === 'reviews' ? '?partial=reviews' : ''

      if (batch.status === 'review' || batch.status === 'done') {
        return redirect(`${routes.profile.imports.review.href({ batchId: batch.id })}${partial}`, 303)
      }

      return context.render(
        <ImportMatchingPage
          displayName={displayName}
          total={batch.total_rows}
          matched={batch.matched_rows}
          failed={batch.status === 'failed'}
          error={batch.error ?? undefined}
          progressHref={routes.profile.imports.progress.href({ batchId: batch.id })}
          reviewHref={`${routes.profile.imports.review.href({ batchId: batch.id })}${partial}`}
        />,
      )
    },

    // Counts only. The matching page polls this rather than reloading itself,
    // so leaving and coming back costs nothing.
    async progress(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      return Response.json({
        status: batch.status,
        total: batch.total_rows,
        matched: batch.matched_rows,
        error: batch.error ?? null,
      })
    },

    async review(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch, displayName } = found

      if (batch.status === 'matching' || batch.status === 'failed') {
        return redirect(routes.profile.imports.show.href({ batchId: batch.id }), 303)
      }

      const { model } = await loadReview(context.get(Database), batch)

      return context.render(
        <ImportReviewPage
          displayName={displayName}
          batch={batch}
          model={model}
          saved={batch.status === 'done'}
          reviewsOnly={context.url.searchParams.get('partial') === 'reviews'}
          error={context.url.searchParams.get('error') ?? undefined}
        />,
      )
    },

    // Feeds the picker. Searched with the row's own title and year, because the
    // year is what tells two same-named films apart, and marked up with any
    // entry another row in this batch already holds.
    async candidates(context: ImportRowContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      const { rows } = await loadReview(context.get(Database), batch)
      const row = rows.find((candidate) => candidate.id === Number(context.params.rowId))
      if (!row) return new Response('Not found', { status: 404 })

      const provider = getCatalogProvider(batch.media_type as MediaType)
      const typed = context.url.searchParams.get('q')?.trim()
      const query = typed || [row.raw_title, row.raw_year].filter(Boolean).join(' ')

      const results = await provider.search(query)

      // Which catalog entries other rows already use, so the picker can say so
      // rather than let someone silently recreate the duplicate they opened it
      // to fix.
      const claimedBy = new Map<string, number>()
      for (const other of rows) {
        if (other.id === row.id || other.matched_external_id == null || other.state === 'skipped') continue
        claimedBy.set(other.matched_external_id, other.row_index)
      }

      return Response.json({
        rowIndex: row.row_index,
        title: row.raw_title,
        year: row.raw_year ?? null,
        query,
        suggestedExternalId: row.matched_external_id ?? null,
        candidates: results.slice(0, 8).map((result) => ({
          externalId: result.externalId,
          title: result.title,
          year: result.releaseYear ?? null,
          creator: result.creator ?? null,
          posterUrl: result.posterUrl ?? null,
          claimedByRow: claimedBy.get(result.externalId) ?? null,
        })),
      })
    },

    async resolve(context: ImportRowContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      const db = context.get(Database)
      const formData = context.get(FormData)
      const rowId = Number(context.params.rowId)
      const action = String(formData.get('action') ?? '')

      if (action === 'confirm' || action === 'take') {
        await confirmRow(db, batch, rowId)
      } else if (action === 'keep') {
        await keepRow(db, batch, rowId)
      } else if (action === 'skip') {
        await skipRow(db, batch, rowId)
      } else if (action === 'repoint') {
        const externalId = String(formData.get('external_id') ?? '').trim()
        if (!externalId) return backToReview(batch, 'Choose a film first.')

        const outcome = await repointRow(db, batch, rowId, externalId)
        if (!outcome.ok) return backToReview(batch, outcome.error)
      }

      return backToReview(batch)
    },

    // The one bulk accept the page offers. Which rows qualify is recomputed
    // here rather than taken from the form: the button says "the remaining N
    // off-by-one matches", and that has to be what it does.
    async bulk(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      const db = context.get(Database)
      const { model } = await loadReview(db, batch)

      const rowIds = model.uncertain
        .filter(({ row }) =>
          isBulkAcceptable({ state: 'uncertain', reason: row.reason, yearDelta: row.yearDelta }),
        )
        .map(({ row }) => row.id)

      await acceptBulk(db, batch, rowIds)
      return backToReview(batch)
    },

    async conflicts(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      const choice = String(context.get(FormData).get('choice') ?? '') === 'take' ? 'take' : 'keep'
      await setConflictChoice(context.get(Database), batch.id, choice)

      return backToReview(batch)
    },

    async save(context: ImportBatchContext) {
      const found = await findBatch(context)
      if (!found.ok) return found.response
      const { batch } = found

      // Saving twice would re-upsert every row over the log it just wrote.
      if (batch.status !== 'review') return backToReview(batch)

      await saveBatch(context.get(Database), batch)
      return backToReview(batch)
    },
  },
})
