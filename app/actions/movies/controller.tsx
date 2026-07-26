import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import {
  listUserMovieLog,
  logInteraction,
  searchAndImportMovies,
  type LogInteractionInput,
} from '../../data/movies.ts'
import type { MediaItem, User } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Nav } from '../../ui/nav.tsx'

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
  q: f.field(s.defaulted(s.string(), '')),
})

interface MoviesSearchPageProps {
  query: string
  results: MediaItem[]
  log: Awaited<ReturnType<typeof listUserMovieLog>>
  message?: string
}

function MoviesSearchPage(handle: Handle<MoviesSearchPageProps>) {
  return () => {
    const { query, results, log, message } = handle.props

    return (
      <Document title="Search movies | On Deck">
        <Nav authed={true} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Search movies</h1>
          {message && <p mix={css({ color: '#15803d' })}>{message}</p>}
          <form
            method="get"
            action={routes.movies.search.href()}
            mix={css({ display: 'flex', gap: '8px', marginBottom: '24px' })}
          >
            <input type="text" name="q" defaultValue={query} placeholder="Search TMDB for a movie…" />
            <button type="submit">Search</button>
          </form>

          {results.length > 0 && (
            <section>
              <h2>Results</h2>
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
                {results.map((item) => {
                  const metadata = JSON.parse(item.metadata) as { releaseYear: number | null }
                  return (
                    <li
                      key={item.id}
                      mix={css({ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' })}
                    >
                      <strong>{item.title}</strong>
                      {metadata.releaseYear ? ` (${metadata.releaseYear})` : ''}
                      <form
                        method="post"
                        action={routes.movies.log.href({ mediaItemId: String(item.id) })}
                        mix={css({ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' })}
                      >
                        <input type="hidden" name="q" value={query} />
                        <select name="status">
                          <option value="want_to_consume">Want to watch</option>
                          <option value="in_progress">Watching</option>
                          <option value="consumed">Watched</option>
                          <option value="dropped">Dropped</option>
                        </select>
                        <input type="number" name="rating" min="1" max="10" step="1" placeholder="Rating 1-10" />
                        <input type="text" name="notes" placeholder="What did you think?" />
                        <button type="submit">Save</button>
                      </form>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section mix={css({ marginTop: '32px' })}>
            <h2>My movie log</h2>
            {log.length === 0 ? (
              <p>Nothing logged yet — search above and save a status for a movie.</p>
            ) : (
              <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' })}>
                {log.map(({ interaction, item }) => (
                  <li key={interaction.id}>
                    <strong>{item?.title ?? 'Unknown title'}</strong> — {interaction.status}
                    {interaction.rating != null ? ` (${interaction.rating}/10)` : ''}
                    {interaction.notes ? `: "${interaction.notes}"` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </Document>
    )
  }
}

export default createController(routes.movies, {
  middleware: [requireAuth<User>()],
  actions: {
    async search(context) {
      const db = context.get(Database)
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const query = context.url.searchParams.get('q')?.trim() ?? ''
      const results = query ? await searchAndImportMovies(db, query) : []
      const log = await listUserMovieLog(db, auth.identity.id)

      return context.render(<MoviesSearchPage query={query} results={results} log={log} />)
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

      const ratingRaw = parsed.value.rating.trim()
      const rating = ratingRaw && Number.isFinite(Number(ratingRaw)) ? Number(ratingRaw) : null

      const db = context.get(Database)
      await logInteraction(db, auth.identity.id, mediaItemId, {
        status: parsed.value.status as LogInteractionInput['status'],
        rating,
        notes: parsed.value.notes || null,
      })

      const q = parsed.value.q
      return redirect(`${routes.movies.search.href()}${q ? `?q=${encodeURIComponent(q)}` : ''}`, 303)
    },
  },
})
