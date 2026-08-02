import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import { getCatalogProvider, rematchCatalogItem, searchAndImport, upsertCatalogItem } from '../data/catalog.ts'
import type { Db } from '../data/db.ts'
import {
  getMediaItemDetail,
  getUserInteractionForItem,
  getUserInteractionsForItems,
  logInteraction,
  type LogInteractionInput,
} from '../data/mediaCatalog.ts'
import type { User } from '../data/schema.ts'
import { displayLabel } from '../data/users.ts'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../utils/mediaTypes.ts'
import { parseMediaMetadata } from '../utils/mediaMetadata.ts'
import { parseRatingInput } from '../utils/stars.ts'
import { MediaDetailPage } from '../ui/pages/media-detail-page.tsx'
import { MediaSearchPage } from '../ui/pages/media-search-page.tsx'

const SUGGESTION_LIMIT = 6

// How many search hits are visible before scrolling reveals more. The whole
// result set is rendered — see the LazyList island, which hides the overflow
// client-side so the page still works fully without JS.
const SEARCH_INITIAL_VISIBLE = 10


const logSchema = f.object({
  status: f.field(s.union([s.literal('want_to_consume'), s.literal('in_progress'), s.literal('consumed')])),
  rating: f.field(s.defaulted(s.string(), '')),
  notes: f.field(s.defaulted(s.string(), '')),
  return_to: f.field(s.defaulted(s.string(), '')),
})

// The six actions every media type's controller needs, with the type-specific
// bits (which catalog to search, which routes to build) resolved from the
// registry and the provider rather than hardcoded per copy.
//
// This is a factory over the *actions*, not over createController itself:
// createController resolves its action types from the concrete route map, and
// routes.movies.show / routes.tv.show are different generic instantiations, so
// a controller factory generic over the route map can't typecheck. Each
// controller therefore stays a ~10-line createController call that passes its
// own route map and spreads these handlers in.
//
// `context` is loosely typed for the same reason — extracting the handlers out
// of createController loses its inference, and the middleware-installed
// `render` property isn't on the bare RequestContext type. Each handler
// re-establishes concrete types immediately (see `db`/`auth` below), so the
// looseness is confined to the parameter itself. Same tradeoff as
// getRememberedMediaType in middleware/mediaType.ts.
export function createMediaActions(mediaType: ActiveMediaType) {
  const ui = MEDIA_TYPE_UI[mediaType]
  const provider = getCatalogProvider(mediaType)

  return {
    async search(context: any) {
      const db: Db = context.get(Database)
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })
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

    // Live catalog search for the autosuggest dropdown — deliberately doesn't
    // import/upsert anything, unlike `search`, since most keystrokes never
    // turn into a pick. Import only happens once you submit an actual search.
    async suggest(context: any) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      if (query.length < 2) return Response.json({ suggestions: [] })

      const results = await provider.search(query)
      const suggestions = results.slice(0, SUGGESTION_LIMIT).map((result) => ({
        key: result.externalId,
        label: result.title,
        sublabel: result.releaseYear ? String(result.releaseYear) : undefined,
        imageUrl: result.posterUrl ?? undefined,
      }))

      return Response.json({ suggestions })
    },

    // Where picking an autosuggest option lands — imports the exact entry the
    // suggestion already resolved (by id) and goes straight to it, instead of
    // resubmitting a title search that could in principle turn up something
    // else and definitely re-hits the catalog for no reason.
    async import(context: any) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const externalId = context.url.searchParams.get('externalId')?.trim() ?? ''
      if (!externalId) return redirect(ui.hrefs.search(), 303)

      const result = await provider.getById(externalId)
      if (!result) return redirect(ui.hrefs.search(), 303)

      const db: Db = context.get(Database)
      const item = await upsertCatalogItem(db, mediaType, result)

      const from = context.url.searchParams.get('from') || undefined
      const showHref = ui.hrefs.show(item.id)
      return redirect(from ? `${showHref}?from=${encodeURIComponent(from)}` : showHref, 303)
    },

    async show(context: any) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })
      const identity: User = auth.identity

      const mediaItemId = Number(context.params.mediaItemId)
      const db: Db = context.get(Database)
      let item = await getMediaItemDetail(db, mediaItemId)
      if (!item) return new Response('Not Found', { status: 404 })

      // Credits only come back from a by-id lookup, never from search — so
      // anything that entered the catalog via a search result has none. Fill
      // it in on first view and persist, rather than making every search pay
      // for 20 detail requests up front.
      //
      // Gated on runtimeMinutes being absent too, because a by-id lookup sets
      // both: if runtime is already there, this item has been enriched and a
      // missing credit is genuinely missing, not un-fetched. Without that,
      // a film TMDB has no director for would re-request on every view.
      const meta = parseMediaMetadata(item.metadata)
      if (meta.creator === null && meta.runtimeMinutes === null && item.external_source === provider.sourceName) {
        const enriched = await provider.getById(item.external_id)
        if (enriched) {
          await upsertCatalogItem(db, mediaType, enriched)
          item = (await getMediaItemDetail(db, mediaItemId)) ?? item
        }
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
          rematchError={context.url.searchParams.get('rematchError') || undefined}
          rematched={context.url.searchParams.get('rematched') === '1'}
          merged={context.url.searchParams.get('merged') === '1'}
        />,
      )
    },

    // Manual fix for a bad title/year match — re-points this item at a
    // different catalog entry by id/link rather than trying to auto-detect
    // low-confidence matches, since there's no reliable signal for that yet.
    async rematch(context: any) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

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

      // A merge deletes the original item, so `returnTo` (which points at
      // mediaItemId's own page) is only still valid when nothing merged —
      // otherwise land on the item everything just got merged into.
      const from = new URL(returnTo, context.url.origin).searchParams.get('from')
      const successPath = ui.hrefs.show(outcome.item.id)
      const query = new URLSearchParams({ rematched: '1' })
      if (outcome.merged) query.set('merged', '1')
      if (from) query.set('from', from)

      return redirect(`${successPath}?${query.toString()}`, 303)
    },

    async log(context: any) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })
      const identity: User = auth.identity

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const parsed = s.parseSafe(logSchema, formData)

      if (!parsed.success) {
        return new Response('Invalid log input', { status: 400 })
      }

      const rating = parseRatingInput(parsed.value.rating)

      const db: Db = context.get(Database)
      await logInteraction(db, identity.id, mediaItemId, {
        // The schema union widens to string through f.field/s.union, so the
        // parse has already validated this even though the type says otherwise.
        status: parsed.value.status as LogInteractionInput['status'],
        rating,
        notes: parsed.value.notes || null,
      })

      return redirect(parsed.value.return_to || ui.hrefs.search(), 303)
    },
  }
}
