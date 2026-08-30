import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'
import type { Handle, RemixNode } from 'remix/ui'

import { activeBatch, createBatch, type ParsedRow } from '../../data/imports/batches.ts'
import type { MediaType } from '../../data/mediaItems.ts'
import { displayLabel } from '../../data/users.ts'
import type { AuthedControllerContext } from '../../middleware/context.ts'
import { routes } from '../../routes.ts'

// Uploading an export and staging it as a batch — the shape shared by
// import-movies (Letterboxd) and import-books (Goodreads). import-games is not
// one of these: Steam is a linked account, so it has no file and no upload form.
//
// The pages are deliberately not shared. Their copy, their layout and what they
// tell you to export all differ per source; only the three props a controller
// fills in are common, which is what ImportPageProps names.
//
// Written out rather than inferred, like createMediaActions: createController
// derives action types from the concrete route map, and importBooks and
// importMovies are different generic instantiations, so a factory generic over
// the route map can't typecheck. These two controllers add nothing but
// requireAuth, which is exactly AuthedControllerContext.

export interface ImportPageProps {
  displayName: string
  error?: string
  // Set when an earlier upload is still waiting to be matched or reviewed.
  pendingHref?: string
}

export interface ParsedUpload {
  rows: ParsedRow[]
  // Reviews without ratings — the films written about rather than what was
  // watched. A source with no such distinction leaves this off, and the
  // redirect below then carries no marker.
  reviewsOnly?: boolean
}

export interface FileImportConfig {
  mediaType: MediaType
  // Recorded on the batch, so the review page can say where a row came from.
  source: string
  page: (handle: Handle<ImportPageProps>) => () => RemixNode
  // The form field the file arrives in.
  fieldName: string
  // Decoding belongs to the source: a Goodreads export is text, a Letterboxd
  // one is a zip that has to be read as bytes. Throwing from here is fine —
  // the message reaches the page.
  parse: (file: File) => Promise<ParsedUpload>
  // Shown when the form arrives with no file, and when the file parsed but
  // held nothing importable. Both name the actual export, so they're per source.
  missingFileError: string
  emptyError: string
}

// Where a staged batch is sent to be looked at. `partial=reviews` is how the
// review page knows to say that only the written-about entries came across;
// a source that never sets reviewsOnly always lands on the bare href.
//
// Its own function because the staging write next to it needs a database, so
// this is the part of the redirect a test can hold still.
export function stagedBatchHref(batchId: string, reviewsOnly?: boolean): string {
  const href = routes.profile.imports.show.href({ batchId })
  return reviewsOnly ? `${href}?partial=reviews` : href
}

export function createFileImportActions(config: FileImportConfig) {
  const { mediaType, source, page: Page, fieldName, parse, missingFileError, emptyError } = config

  function fail(context: AuthedControllerContext, error: string): Response {
    return context.render(
      <Page error={error} displayName={displayLabel(context.get(Auth).identity)} />,
      { status: 400 },
    )
  }

  return {
    async index(context: AuthedControllerContext) {
      const auth = context.get(Auth)

      // An import someone is midway through outranks the upload form: starting
      // a second one would orphan the review they haven't finished.
      const pending = await activeBatch(context.get(Database), auth.identity.id, mediaType)

      return context.render(
        <Page
          displayName={displayLabel(auth.identity)}
          pendingHref={pending ? routes.profile.imports.show.href({ batchId: pending.id }) : undefined}
        />,
      )
    },

    async upload(context: AuthedControllerContext) {
      const auth = context.get(Auth)
      const file = context.get(FormData).get(fieldName)

      if (!(file instanceof File) || file.size === 0) return fail(context, missingFileError)

      const db = context.get(Database)

      try {
        const { rows, reviewsOnly } = await parse(file)

        if (rows.length === 0) return fail(context, emptyError)

        // The request ends here: matching a few hundred rows is tens of seconds
        // of catalog lookups, which a worker does while this redirect lands.
        const batchId = await createBatch(db, auth.identity.id, mediaType, source, rows)
        return redirect(stagedBatchHref(batchId, reviewsOnly), 303)
      } catch (error) {
        return fail(
          context,
          error instanceof Error ? error.message : 'Something went wrong reading that file.',
        )
      }
    },
  }
}
