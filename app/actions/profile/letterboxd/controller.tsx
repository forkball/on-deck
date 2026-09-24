import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController, type Middleware } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  fetchLetterboxdFeed,
  letterboxdSyncAvailableTo,
  normalizeLetterboxdUsername,
} from '../../../data/imports/letterboxdFeed.ts'
import {
  syncLetterboxdInBackground,
  syncLetterboxdNow,
  type LetterboxdSyncResult,
} from '../../../data/imports/letterboxdSync.ts'
import { users, type User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { count } from '../../../ui/shared/count.ts'

// Hiding the form isn't enough: these routes stay mapped, so a POST would
// still connect an account the gate is meant to have closed. 404 rather than
// 403, because a gated feature shouldn't advertise that it exists.
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

// Back to the connections pane of the settings page. These actions have no
// page of their own, so their outcome has to land on the one that offered the
// form — and on the part of it the person was actually looking at.
//
// Callers pass bare `key=value`, since the leading `?` belongs to the tab that
// always comes first.
function back(params = ''): Response {
  const query = params ? `?tab=connections&${params}` : '?tab=connections'
  return redirect(`${routes.profile.edit.index.href()}${query}`, 303)
}

// What a member gets back for pressing Sync now. Counts rather than a bare
// "done", because the question behind the button is usually whether the feed
// carries a particular entry at all — and a number that moved between two
// presses answers that, where "synced" answers nothing.
//
// Exported for its own test: it is the whole of what the button communicates,
// and it needs no database to demonstrate.
export function describeSync(result: LetterboxdSyncResult): string {
  // Neither of these is an error, and they used to read the same. Once
  // connecting stopped backfilling, "nothing written" became the ordinary
  // state of a fresh connection to a busy diary — so saying Letterboxd wasn't
  // publishing anything was both wrong and the first thing a new member saw.
  if (result.logged === 0 && result.unresolved === 0) {
    return result.carried === 0
      ? "Read your feed — Letterboxd isn't publishing any diary entries for that name yet."
      : 'Read your feed — nothing new since you connected.'
  }

  const parts = [`Read ${count(result.logged, 'diary entry', 'diary entries')} from Letterboxd.`]

  if (result.deleted > 0) {
    parts.push(`Removed ${count(result.deleted, 'film', 'films')} your diary no longer lists.`)
  }

  // Worth naming rather than hiding: an entry the catalog can't place is a film
  // that will never appear here, and counting it is the only sign of that.
  if (result.unresolved > 0) {
    parts.push(`${count(result.unresolved, 'entry', 'entries')} couldn't be matched to a film.`)
  }

  return parts.join(' ')
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
          `letterboxdError=${encodeURIComponent(
            "That doesn't look like a Letterboxd username. They're letters, numbers and underscores — the last part of your profile URL.",
          )}`,
        )
      }

      // Probed before it is stored, so a typo is caught here rather than
      // failing silently in a background sync nobody is watching.
      const outcome = await fetchLetterboxdFeed(username)
      if (!outcome.ok) {
        return back(`letterboxdError=${encodeURIComponent(outcome.message)}`)
      }

      const db = context.get(Database)
      // Stamped on every connect, including a rename: pointing at a different
      // diary starts a new subscription, and carrying the old point over would
      // pull in whatever that diary happened to have published since.
      const connectedAt = Date.now()

      await db.update(users, auth.identity.id, {
        letterboxd_username: username,
        letterboxd_connected_at: connectedAt,
        // Cleared so connecting always syncs, even for a member who
        // disconnected and reconnected inside the cooldown.
        letterboxd_synced_at: undefined,
        // The window belongs to the connection that opened it, so a new one
        // starts with nothing to compare against rather than measuring this
        // diary against the last one's floor.
        letterboxd_feed_floor: undefined,
        letterboxd_feed_items: undefined,
      })

      // Not awaited: the first sync looks up every film it hasn't seen, which
      // is the one time this is slow. The redirect lands on a page that says
      // it's under way.
      syncLetterboxdInBackground(db, {
        ...auth.identity,
        letterboxd_username: username,
        letterboxd_connected_at: connectedAt,
        letterboxd_synced_at: null,
      })

      return back('letterboxdConnected=1')
    },

    // Deliberately the only path that skips the cooldown, and deliberately
    // awaited. Everything else reads the feed beside a render and leaves the
    // result for next time, which is right for a page load and useless to
    // someone checking whether an edit made a minute ago has landed.
    async sync(context) {
      const auth = context.get(Auth)
      const db = context.get(Database)

      let result: LetterboxdSyncResult | null
      try {
        result = await syncLetterboxdNow(db, auth.identity)
      } catch (error) {
        // fetchLetterboxdFeed's messages are already written for a member — a
        // private profile, a bad name, Letterboxd being down — so the one case
        // worth rewording is anything else that got this far.
        const message = error instanceof Error ? error.message : 'Something went wrong reading your diary.'
        return back(`letterboxdError=${encodeURIComponent(message)}`)
      }

      if (!result) {
        return back(`letterboxdError=${encodeURIComponent('Connect a Letterboxd username first.')}`)
      }

      return back(`letterboxdNotice=${encodeURIComponent(describeSync(result))}`)
    },

    async disconnect(context) {
      const auth = context.get(Auth)

      const db = context.get(Database)
      // `undefined` writes NULL rather than skipping the field — the same
      // thing the Steam disconnect relies on. The column type won't accept a
      // literal null.
      await db.update(users, auth.identity.id, {
        letterboxd_username: undefined,
        letterboxd_connected_at: undefined,
        letterboxd_synced_at: undefined,
        letterboxd_feed_floor: undefined,
        letterboxd_feed_items: undefined,
      })

      return back()
    },
  },
})
