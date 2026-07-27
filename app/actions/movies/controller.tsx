import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  getMovieDetail,
  getUserInteractionForItem,
  listDistinctTags,
  listMediaItemsByTag,
  logInteraction,
  searchAndImportMovies,
  type LogInteractionInput,
  type MovieResult,
} from '../../data/movies.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { parseRatingInput } from '../../utils/stars.ts'
import { MovieDetailPage } from './detail-page.tsx'
import { MoviesSearchPage } from './page.tsx'

const logSchema = f.object({
  status: f.field(
    s.union([
      s.literal('want_to_consume'),
      s.literal('in_progress'),
      s.literal('consumed'),
      s.literal('dropped'),
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
      const genre = context.url.searchParams.get('genre')?.trim() ?? ''

      let results: MovieResult[] = []
      if (genre) {
        results = await listMediaItemsByTag(db, genre)
      } else if (query) {
        results = await searchAndImportMovies(db, query)
      }

      const availableTags = await listDistinctTags(db)

      const interactionsByItemId = new Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>()
      for (const { item } of results) {
        interactionsByItemId.set(item.id, await getUserInteractionForItem(db, auth.identity.id, item.id))
      }

      return context.render(
        <MoviesSearchPage
          query={query}
          genre={genre}
          results={results}
          availableTags={availableTags}
          interactionsByItemId={interactionsByItemId}
          displayName={displayLabel(auth.identity)}
        />,
      )
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
        />,
      )
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
