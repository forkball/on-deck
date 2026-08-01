import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import type { User } from '../../../data/schema.ts'
import { importSteamLibrary } from '../../../data/steamImport.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { SteamImportPage } from './page.tsx'

// Mirrors profile/import-movies (Letterboxd) and profile/import-books (Goodreads).
// The import itself lands in the next phase; for now this page owns the
// connection state, which is what the other importers replace with a file
// picker.
// The OpenID callback can only redirect with a code in the query string, so
// the wording lives here rather than travelling through the URL. Anything
// unrecognised is treated as a failed sign-in, since `error` is only ever set
// by that redirect.
function connectError(code: string | null): string | undefined {
  if (!code) return undefined
  if (code === 'taken') return 'That Steam account is already connected to another profile.'
  return "Couldn't verify that Steam sign-in. Try connecting again."
}

export default createController(routes.profile.importGames, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      return context.render(
        <SteamImportPage
          displayName={displayLabel(auth.identity)}
          steamId={auth.identity.steam_id ?? null}
          connected={context.url.searchParams.get('connected') === '1'}
          error={connectError(context.url.searchParams.get('error'))}
        />,
      )
    },

    async upload(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const steamId = auth.identity.steam_id
      // Nothing to import from until an account is linked; the page only
      // shows this button once one is, so reaching here means the link was
      // dropped between render and submit.
      if (!steamId) {
        return context.render(
          <SteamImportPage
            displayName={displayLabel(auth.identity)}
            steamId={null}
            error="Connect a Steam account first."
          />,
          { status: 400 },
        )
      }

      const db = context.get(Database)

      try {
        const result = await importSteamLibrary(db, auth.identity.id, steamId)
        return context.render(
          <SteamImportPage displayName={displayLabel(auth.identity)} steamId={steamId} result={result} />,
        )
      } catch (error) {
        // Steam's own wording for a private profile or an outage — already
        // written to be read, so it passes through rather than being
        // flattened into a generic failure.
        return context.render(
          <SteamImportPage
            displayName={displayLabel(auth.identity)}
            steamId={steamId}
            error={error instanceof Error ? error.message : 'Something went wrong reading your Steam library.'}
          />,
          { status: 400 },
        )
      }
    },
  },
})
