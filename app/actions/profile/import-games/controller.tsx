import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { INTERACTION_SOURCES, users, type User } from '../../../data/schema.ts'
import { activeBatch, createBatch } from '../../../data/imports/batches.ts'
import { steamRows } from '../../../data/imports/steam.ts'
import { fetchSteamLibrary, fetchSteamPersona } from '../../../data/imports/steamApi.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import type { AuthedControllerContext } from '../../../middleware/context.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { stagedBatchHref } from '../file-import-actions.tsx'
import { SteamImportPage } from './page.tsx'

// Like import-movies and import-books, but the source is a linked account
// rather than an uploaded file. Linking it is settings' job — the sign-in
// outcome and its wording land there, not here; this page only imports.
//
// It stages a batch the way they do, and the same worker matches it and the
// same review page settles it: the request only reads the library from Steam,
// which is one call, and never waits on the catalog lookups behind it.

function fail(context: AuthedControllerContext, steamId: string | null, error: string): Response {
  const auth = context.get(Auth)
  return context.render(
    <SteamImportPage displayName={displayLabel(auth.identity)} steamId={steamId} error={error} />,
    { status: 400 },
  )
}

export default createController(routes.profile.importGames, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)

      // An import midway through outranks the button, as on the file importers.
      const pending = await activeBatch(context.get(Database), auth.identity.id, 'game')

      return context.render(
        <SteamImportPage
          displayName={displayLabel(auth.identity)}
          steamId={auth.identity.steam_id ?? null}
          pendingHref={pending ? routes.profile.imports.show.href({ batchId: pending.id }) : undefined}
        />,
      )
    },

    async upload(context) {
      const auth = context.get(Auth)

      const steamId = auth.identity.steam_id
      // The button only renders once linked, so reaching here means the link
      // was dropped between render and submit.
      if (!steamId) return fail(context, null, 'Connect a Steam account first.')

      const db = context.get(Database)

      // One unfinished games import at a time. Checked before Steam is asked,
      // so a double-submit or a back-button resubmit costs nothing and lands
      // where the first one went rather than orphaning it.
      const pending = await activeBatch(db, auth.identity.id, 'game')
      if (pending) return redirect(routes.profile.imports.show.href({ batchId: pending.id }), 303)

      const library = await fetchSteamLibrary(steamId)
      // Steam's own wording, already written to be read.
      if (!library.ok) return fail(context, steamId, library.message)

      // Refreshed on the way past, since an import is already talking to Steam
      // and a rename there would otherwise leave settings naming an account by
      // a name its owner has stopped using. Null means Steam wouldn't say this
      // time, which is no reason to throw away the name it gave last time.
      const persona = await fetchSteamPersona(steamId)
      if (persona) await db.update(users, auth.identity.id, { steam_persona: persona })

      const rows = steamRows(library.games)
      if (rows.length === 0) {
        return fail(context, steamId, 'Your Steam library has no games in it to import.')
      }

      const batchId = await createBatch(db, auth.identity.id, 'game', INTERACTION_SOURCES.steam, rows)
      return redirect(stagedBatchHref(batchId), 303)
    },
  },
})
