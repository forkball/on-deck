import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  getMediaItemDetail,
  getUserInteractionForItem,
  logInteraction,
  type LogInteractionInput,
} from '../../data/mediaCatalog.ts'
import { rematchTvShow, searchAndImportTv, upsertTvShow } from '../../data/tv.ts'
import { getTvShowById, parseTmdbId, searchTv } from '../../data/tmdb.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { rememberMediaType } from '../../middleware/mediaType.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { parseRatingInput } from '../../utils/stars.ts'
import { TvDetailPage } from './detail-page.tsx'
import { TvSearchPage } from './page.tsx'

const SUGGESTION_LIMIT = 6

const logSchema = f.object({
  status: f.field(
    s.union([
      s.literal('want_to_consume'),
      s.literal('in_progress'),
      s.literal('consumed'),
    ]),
  ),
  rating: f.field(s.defaulted(s.string(), '')),
  notes: f.field(s.defaulted(s.string(), '')),
  return_to: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.tv, {
  middleware: [requireAuth<User>(), rememberMediaType('tv')],
  actions: {
    async search(context) {
      const db = context.get(Database)
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''

      const results = query ? await searchAndImportTv(db, query) : []

      const interactionsByItemId = new Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>()
      for (const { item } of results) {
        interactionsByItemId.set(item.id, await getUserInteractionForItem(db, auth.identity.id, item.id))
      }

      return context.render(
        <TvSearchPage
          query={query}
          results={results}
          interactionsByItemId={interactionsByItemId}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    // Live TMDB search for the autosuggest dropdown — see movies/controller.tsx.
    async suggest(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      if (query.length < 2) return Response.json({ suggestions: [] })

      const results = await searchTv(query)
      const suggestions = results.slice(0, SUGGESTION_LIMIT).map((result) => ({
        key: result.externalId,
        label: result.title,
        sublabel: result.releaseYear ? String(result.releaseYear) : undefined,
        imageUrl: result.posterUrl ?? undefined,
      }))

      return Response.json({ suggestions })
    },

    async import(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const externalId = context.url.searchParams.get('externalId')?.trim() ?? ''
      if (!externalId) return redirect(routes.tv.search.href(), 303)

      const result = await getTvShowById(externalId)
      if (!result) return redirect(routes.tv.search.href(), 303)

      const db = context.get(Database)
      const item = await upsertTvShow(db, result)

      const from = context.url.searchParams.get('from') || undefined
      const showHref = routes.tv.show.href({ mediaItemId: String(item.id) })
      return redirect(from ? `${showHref}?from=${encodeURIComponent(from)}` : showHref, 303)
    },

    async show(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaItemId = Number(context.params.mediaItemId)
      const db = context.get(Database)
      const detail = await getMediaItemDetail(db, mediaItemId)
      if (!detail) return new Response('Not Found', { status: 404 })

      const interaction = await getUserInteractionForItem(db, auth.identity.id, mediaItemId)
      const from = context.url.searchParams.get('from') || undefined

      return context.render(
        <TvDetailPage
          item={detail.item}
          tags={detail.tags}
          interaction={interaction}
          from={from}
          displayName={displayLabel(auth.identity)}
          rematchError={context.url.searchParams.get('rematchError') || undefined}
          rematched={context.url.searchParams.get('rematched') === '1'}
          merged={context.url.searchParams.get('merged') === '1'}
        />,
      )
    },

    async rematch(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const link = String(formData.get('tmdb_link') || '')
      const returnTo =
        String(formData.get('return_to') || '') || routes.tv.show.href({ mediaItemId: String(mediaItemId) })
      const separator = returnTo.includes('?') ? '&' : '?'

      const db = context.get(Database)
      const tmdbId = parseTmdbId(link, 'tv')
      const outcome = tmdbId
        ? await rematchTvShow(db, mediaItemId, tmdbId)
        : { ok: false as const, error: 'Paste a TMDB show link or id.' }

      if (!outcome.ok) {
        return redirect(`${returnTo}${separator}rematchError=${encodeURIComponent(outcome.error)}`, 303)
      }

      const from = new URL(returnTo, context.url.origin).searchParams.get('from')
      const successPath = routes.tv.show.href({ mediaItemId: String(outcome.item.id) })
      const query = new URLSearchParams({ rematched: '1' })
      if (outcome.merged) query.set('merged', '1')
      if (from) query.set('from', from)

      return redirect(`${successPath}?${query.toString()}`, 303)
    },

    async log(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const parsed = s.parseSafe(logSchema, formData)

      if (!parsed.success) {
        return new Response('Invalid log input', { status: 400 })
      }

      const rating = parseRatingInput(parsed.value.rating)

      const db = context.get(Database)
      await logInteraction(db, auth.identity.id, mediaItemId, {
        status: parsed.value.status as LogInteractionInput['status'],
        rating,
        notes: parsed.value.notes || null,
      })

      return redirect(parsed.value.return_to || routes.tv.search.href(), 303)
    },
  },
})
