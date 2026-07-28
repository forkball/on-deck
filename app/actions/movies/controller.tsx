import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  getMovieDetail,
  getUserInteractionForItem,
  logInteraction,
  rematchMovie,
  searchAndImportMovies,
  upsertMovie,
  type LogInteractionInput,
  type MovieResult,
} from '../../data/movies.ts'
import { getMovieById, parseTmdbMovieId, searchMovies } from '../../data/tmdb.ts'
import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { parseRatingInput } from '../../utils/stars.ts'
import { MovieDetailPage } from './detail-page.tsx'
import { MoviesSearchPage } from './page.tsx'

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

export default createController(routes.movies, {
  middleware: [requireAuth<User>()],
  actions: {
    async search(context) {
      const db = context.get(Database)
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''

      const results = query ? await searchAndImportMovies(db, query) : []

      const interactionsByItemId = new Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>()
      for (const { item } of results) {
        interactionsByItemId.set(item.id, await getUserInteractionForItem(db, auth.identity.id, item.id))
      }

      return context.render(
        <MoviesSearchPage
          query={query}
          results={results}
          interactionsByItemId={interactionsByItemId}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    // Live TMDB search for the autosuggest dropdown — deliberately doesn't
    // import/upsert anything, unlike `search`, since most keystrokes never
    // turn into a pick. Import only happens once you submit an actual search.
    async suggest(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      if (query.length < 2) return Response.json({ suggestions: [] })

      const results = await searchMovies(query)
      const suggestions = results.slice(0, SUGGESTION_LIMIT).map((result) => ({
        key: result.externalId,
        label: result.title,
        sublabel: result.releaseYear ? String(result.releaseYear) : undefined,
        imageUrl: result.posterUrl ?? undefined,
      }))

      return Response.json({ suggestions })
    },

    // Where picking an autosuggest option lands — imports the exact TMDB
    // movie the suggestion already resolved (by id) and goes straight to it,
    // instead of resubmitting a title search that could in principle turn up
    // something else and definitely re-hits TMDB for no reason.
    async import(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const externalId = context.url.searchParams.get('externalId')?.trim() ?? ''
      if (!externalId) return redirect(routes.movies.search.href(), 303)

      const result = await getMovieById(externalId)
      if (!result) return redirect(routes.movies.search.href(), 303)

      const db = context.get(Database)
      const item = await upsertMovie(db, result)

      const from = context.url.searchParams.get('from') || undefined
      const showHref = routes.movies.show.href({ mediaItemId: String(item.id) })
      return redirect(from ? `${showHref}?from=${encodeURIComponent(from)}` : showHref, 303)
    },

    async show(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaItemId = Number(context.params.mediaItemId)
      const db = context.get(Database)
      const detail = await getMovieDetail(db, mediaItemId)
      if (!detail) return new Response('Not Found', { status: 404 })

      const interaction = await getUserInteractionForItem(db, auth.identity.id, mediaItemId)
      const from = context.url.searchParams.get('from') || undefined

      return context.render(
        <MovieDetailPage
          item={detail.item}
          tags={detail.tags}
          interaction={interaction}
          from={from}
          displayName={displayLabel(auth.identity)}
          rematchError={context.url.searchParams.get('rematchError') || undefined}
          rematched={context.url.searchParams.get('rematched') === '1'}
        />,
      )
    },

    // Manual fix for a bad title/year match — re-points this item at a
    // different TMDB movie by id/link rather than trying to auto-detect
    // low-confidence matches, since there's no reliable signal for that yet.
    async rematch(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const mediaItemId = Number(context.params.mediaItemId)
      const formData = context.get(FormData)
      const link = String(formData.get('tmdb_link') || '')
      const returnTo =
        String(formData.get('return_to') || '') || routes.movies.show.href({ mediaItemId: String(mediaItemId) })
      const separator = returnTo.includes('?') ? '&' : '?'

      const db = context.get(Database)
      const tmdbId = parseTmdbMovieId(link)
      const outcome = tmdbId
        ? await rematchMovie(db, mediaItemId, tmdbId)
        : { ok: false as const, error: 'Paste a TMDB movie link or id.' }

      if (!outcome.ok) {
        return redirect(`${returnTo}${separator}rematchError=${encodeURIComponent(outcome.error)}`, 303)
      }

      return redirect(`${returnTo}${separator}rematched=1`, 303)
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

      return redirect(parsed.value.return_to || routes.movies.search.href(), 303)
    },
  },
})
