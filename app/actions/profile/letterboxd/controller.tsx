import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController, type Middleware } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  fetchLetterboxdFeed,
  letterboxdSyncAvailableTo,
  normalizeLetterboxdUsername,
} from '../../../data/imports/letterboxdFeed.ts'
import { syncLetterboxdInBackground } from '../../../data/imports/letterboxdSync.ts'
import { users, type User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'

// Hiding the form isn't enough: these routes stay mapped, so a POST would
// still connect an account the gate is meant to have closed. 404 rather than
// 403, matching requireEnabledMediaType — a gated feature shouldn't advertise
// that it exists.
//
// Ordered after requireAuth in the list below, not before. loadAuth() populates
// Auth for every request, so either order sees it — but anonymous requests
// resolve to a state with no identity, and this gate would answer 404 to
// someone who simply isn't signed in yet. Behind requireAuth they get the login
// redirect instead, and only a signed-in member is ever judged on admin.
const requireLetterboxdSync: Middleware = async (context, next) => {
  // Typed loosely because a standalone middleware carries none of the identity
  // type requireAuth gives the actions, and read defensively so a gate that
  // cannot identify the caller closes rather than throws.
  const auth = context.get(Auth) as { identity?: User } | undefined

  return auth?.identity && letterboxdSyncAvailableTo(auth.identity)
    ? next()
    : new Response('Not Found', { status: 404 })
}

function back(query = ''): Response {
  return redirect(`${routes.profile.importMovies.index.href()}${query}`, 303)
}

// Not a linked account — the feed this names is public, so nothing here proves
// the member typing it is the member it belongs to. The page says as much.
export default createController(routes.profile.letterboxd, {
  middleware: [requireAuth<User>(), requireLetterboxdSync],
  actions: {
    async connect(context) {
      const auth = context.get(Auth)
      const formData = context.get(FormData)

      const username = normalizeLetterboxdUsername(String(formData.get('username') ?? ''))
      if (!username) {
        return back(
          `?letterboxdError=${encodeURIComponent(
            'That doesn\'t look like a Letterboxd username. They\'re letters, numbers and underscores — the last part of your profile URL.',
          )}`,
        )
      }

      // Probed before it is stored, so a typo is caught here rather than
      // failing silently in a background sync nobody is watching.
      const outcome = await fetchLetterboxdFeed(username)
      if (!outcome.ok) {
        return back(`?letterboxdError=${encodeURIComponent(outcome.message)}`)
      }

      const db = context.get(Database)
      await db.update(users, auth.identity.id, {
        letterboxd_username: username,
        // Cleared so connecting always syncs, even for a member who
        // disconnected and reconnected inside the cooldown.
        letterboxd_synced_at: undefined,
      })

      // Not awaited: the first sync looks up every film it hasn't seen, which
      // is the one time this is slow. The redirect lands on a page that says
      // it's under way.
      syncLetterboxdInBackground(db, {
        ...auth.identity,
        letterboxd_username: username,
        letterboxd_synced_at: null,
      })

      return back('?letterboxdConnected=1')
    },

    async disconnect(context) {
      const auth = context.get(Auth)

      const db = context.get(Database)
      // `undefined` writes NULL rather than skipping the field — the same
      // thing the Steam disconnect relies on. The column type won't accept a
      // literal null.
      await db.update(users, auth.identity.id, {
        letterboxd_username: undefined,
        letterboxd_synced_at: undefined,
      })

      return back()
    },
  },
})
