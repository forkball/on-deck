import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import type { User } from '../../../data/schema.ts'
import { memberFacingMessage } from '../../../data/imports/importError.ts'
import { importSteamLibrary } from '../../../data/imports/steam.ts'
import { logger } from '../../../log.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { displayLabel } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { SteamImportPage } from './page.tsx'

const log = logger('steam-import')

// Like import-movies and import-books, but the source is a linked account
// rather than an uploaded file. Linking it is settings' job — the sign-in
// outcome and its wording land there, not here; this page only imports.

export default createController(routes.profile.importGames, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)

      return context.render(
        <SteamImportPage
          displayName={displayLabel(auth.identity)}
          steamId={auth.identity.steam_id ?? null}
        />,
      )
    },

    async upload(context) {
      const auth = context.get(Auth)

      const steamId = auth.identity.steam_id
      // The button only renders once linked, so reaching here means the link
      // was dropped between render and submit.
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
        // Steam's outcome is worded for the member; anything else (a catalog
        // or database failure) is logged and gets the generic line.
        const message = memberFacingMessage(error)
        if (message === null) log.error(`import failed for user ${auth.identity.id}`, error)
        return context.render(
          <SteamImportPage
            displayName={displayLabel(auth.identity)}
            steamId={steamId}
            error={message ?? 'Something went wrong reading your Steam library.'}
          />,
          { status: 400 },
        )
      }
    },
  },
})
