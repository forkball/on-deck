import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { buildSteamLoginUrl, verifySteamCallback } from '../../../data/steam.ts'
import { users, type User } from '../../../data/schema.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { externalOrigin } from '../../../utils/requestOrigin.ts'

// Links a Steam account to the signed-in On Deck account. Not an app login —
// the password auth is untouched; this only records which Steam account to
// read a library from.
export default createController(routes.profile.steam, {
  middleware: [requireAuth<User>()],
  actions: {
    connect(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      // Derived from the live request, not configured: this runs on
      // localhost in development and on Fly in production, and Steam
      // requires `realm` and `return_to` to agree with each other and with
      // where the browser actually is — including the scheme, which behind
      // Fly's TLS proxy only the forwarded header knows.
      const origin = externalOrigin(context.url, context.request.headers)
      return redirect(buildSteamLoginUrl(origin, `${origin}${routes.profile.steam.callback.href()}`), 303)
    },

    async callback(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      // Every parameter here came back through the browser and is therefore
      // attacker-supplied. verifySteamCallback hands them to Steam to
      // confirm it signed them; anything forged or replayed returns null.
      const steamId = await verifySteamCallback(context.url.searchParams)
      if (!steamId) {
        return redirect(`${routes.profile.importGames.index.href()}?error=1`, 303)
      }

      const db = context.get(Database)

      // The unique index means a second account can't claim the same
      // library; surface that rather than letting the write throw.
      const existing = await db.findOne(users, { where: { steam_id: steamId } })
      if (existing && existing.id !== auth.identity.id) {
        return redirect(`${routes.profile.importGames.index.href()}?error=taken`, 303)
      }

      await db.update(users, auth.identity.id, { steam_id: steamId })
      return redirect(`${routes.profile.importGames.index.href()}?connected=1`, 303)
    },

    async disconnect(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      // `undefined` writes NULL here rather than skipping the field —
      // verified against the database, and the same thing updateUserBio
      // relies on. The column type won't accept a literal null.
      await db.update(users, auth.identity.id, { steam_id: undefined })
      return redirect(routes.profile.importGames.index.href(), 303)
    },
  },
})
