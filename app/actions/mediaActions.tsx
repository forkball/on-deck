import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import {
  backfillCatalogDetail,
  getCatalogProvider,
  rematchCatalogItem,
  searchAndImport,
  searchCatalog,
  upsertCatalogItem,
} from '../data/catalog/provider.ts'
import type { Db } from '../data/db.ts'
import {
  getMediaItemDetail,
  getUserInteractionForItem,
  getUserInteractionsForItems,
  logInteraction,
  parseRatingSubmission,
} from '../data/mediaItems.ts'
import { INTERACTION_STATUSES, type User } from '../data/schema.ts'
import type { MediaControllerContext, MediaItemControllerContext } from '../middleware/context.ts'
import { displayLabel } from '../data/users.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../mediaTypes.ts'
import { parseMediaMetadata } from '../data/mediaMetadata.ts'
import { MediaDetailPage } from '../ui/pages/media-detail-page.tsx'
import { MediaSearchPage } from '../ui/pages/media-search-page.tsx'

const SUGGESTION_LIMIT = 6

const SEARCH_INITIAL_VISIBLE = 10


const logSchema = f.object({
  status: f.field(s.enum_(INTERACTION_STATUSES)),
  rating: f.field(s.defaulted(s.string(), '')),
  notes: f.field(s.defaulted(s.string(), '')),
  return_to: f.field(s.defaulted(s.string(), '')),
})

// Written out rather than inferred. createController derives action types from
// the concrete route map, and routes.movies.show and routes.tv.show are
// different generic instantiations, so a factory generic over the route map
// can't typecheck — which is what left these handlers on `any`.
//
// The context types name only what these handlers read — see
// middleware/context.ts for why that is what makes them assignable.
export function createMediaActions(mediaType: ActiveMediaType) {
  const ui = MEDIA_TYPE_UI[mediaType]
  const provider = getCatalogProvider(mediaType)

  return {
    async search(context: MediaControllerContext) {
      const db: Db = context.get(Database)
      const auth = context.get(Auth)
      const identity: User = auth.identity

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      const results = query ? await searchAndImport(db, mediaType, query) : []

      const interactionsByItemId = await getUserInteractionsForItems(
        db,
        identity.id,
        results.map((item) => item.id),
      )

      return context.render(
        <MediaSearchPage
          mediaType={mediaType}
          query={query}
          results={results}
          initialVisible={SEARCH_INITIAL_VISIBLE}
          interactionsByItemId={interactionsByItemId}
          displayName={displayLabel(identity)}
        />,
      )
    },

    async suggest(context: MediaControllerContext) {
      const query = context.url.searchParams.get('q')?.trim() ?? ''
      if (query.length < 2) return Response.json({ suggestions: [] })

      // Through the cache, not the provider: this fires while someone is still
      // typing, so it is the heaviest caller in the app and the one whose
      // answer the submitted search is about to want anyway.
      const results = await searchCatalog(mediaType, query)
      const suggestions = results.slice(0, SUGGESTION_LIMIT).map((result) => ({
        key: result.externalId,
        label: result.title,
        sublabel: result.releaseYear ? String(result.releaseYear) : undefined,
        imageUrl: result.posterUrl ?? undefined,
      }))

      return Response.json({ suggestions })
    },

    async import(context: MediaControllerContext) {
      const externalId = context.url.searchParams.get('externalId')?.trim() ?? ''
      if (!externalId) return redirect(ui.hrefs.search(), 303)

      const result = await provider.getById(externalId)
      if (!result) return redirect(ui.hrefs.search(), 303)

      const db: Db = context.get(Database)
      const item = await upsertCatalogItem(db, mediaType, result, true)

      const from = context.url.searchParams.get('from') || undefined
      const showHref = ui.hrefs.show(item.id)
      return redirect(from ? `${showHref}?from=${encodeURIComponent(from)}` : showHref, 303)
    },

    async show(context: MediaItemControllerContext) {
      const auth = context.get(Auth)
      const identity: User = auth.identity

      const mediaItemId = Number(context.params.mediaItemId)
      const db: Db = context.get(Database)
      const item = await getMediaItemDetail(db, mediaItemId)
      if (!item) return new Response('Not Found', { status: 404 })

      // Scheduled, not awaited: the credit line is all this fills in and the
      // page renders without it, so it lands on the next view rather than making
      // every first view wait on a remote round trip. Once per item for
      // everyone, since media_items rows are shared.
      const meta = parseMediaMetadata(item.metadata)
      if (meta.enrichedAt === null && item.external_source === provider.sourceName) {
        backfillCatalogDetail(db, mediaType, item)
      }

      const interaction = await getUserInteractionForItem(db, identity.id, mediaItemId)
      const from = context.url.searchParams.get('from') || undefined

      return context.render(
        <MediaDetailPage
          mediaType={mediaType}
          item={item}
          interaction={interaction}
          from={from}
          displayName={displayLabel(identity)}
          canRematch={identity.is_admin}
          rematchError={context.url.searchParams.get('rematchError') || undefined}
          rematched={context.url.searchParams.get('rematched') === '1'}
          merged={context.url.searchParams.get('merged') === '1'}
        />,
      )
    },

    // Admin-only, and the check is here rather than only on the form: a
    // media_items row is shared by everyone who logged that work, so repointing
    // it rewrites — or, on a merge, deletes — an entry other people's logs hang
    // off. Correcting a bad match for yourself alone is what the import review
    // does (repointRow in data/imports/batches.ts), which stages the change
    // against your own rows and leaves the catalog alone.
    async rematch(context: MediaItemControllerContext) {
      const auth = context.get(Auth)
      if (!auth.identity.is_admin) return new Response('Forbidden', { status: 403 })

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const link = String(formData.get('tmdb_link') || '')
      const returnTo = String(formData.get('return_to') || '') || ui.hrefs.show(mediaItemId)
      const separator = returnTo.includes('?') ? '&' : '?'

      const db: Db = context.get(Database)
      const externalId = provider.parseExternalId(link)
      const outcome = externalId
        ? await rematchCatalogItem(db, mediaType, mediaItemId, externalId)
        : { ok: false as const, error: provider.matchHint }

      if (!outcome.ok) {
        return redirect(`${returnTo}${separator}rematchError=${encodeURIComponent(outcome.error)}`, 303)
      }

      // A merge deletes the original, so `returnTo` is only valid when nothing
      // merged; otherwise land on the item everything merged into.
      const from = new URL(returnTo, context.url.origin).searchParams.get('from')
      const successPath = ui.hrefs.show(outcome.item.id)
      const query = new URLSearchParams({ rematched: '1' })
      if (outcome.merged) query.set('merged', '1')
      if (from) query.set('from', from)

      return redirect(`${successPath}?${query.toString()}`, 303)
    },

    async log(context: MediaItemControllerContext) {
      const auth = context.get(Auth)
      const identity: User = auth.identity

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const parsed = s.parseSafe(logSchema, formData)

      if (!parsed.success) {
        return new Response('Invalid log input', { status: 400 })
      }

      const { rating, disliked } = parseRatingSubmission(parsed.value.rating)

      const db: Db = context.get(Database)
      await logInteraction(db, identity.id, mediaItemId, {
        status: parsed.value.status,
        rating,
        disliked,
        notes: parsed.value.notes || null,
      })

      return redirect(parsed.value.return_to || ui.hrefs.search(), 303)
    },
  }
}
