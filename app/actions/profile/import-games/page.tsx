import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Button, Link } from '../../../ui/shared/form-controls.tsx'

export interface SteamImportPageProps {
  displayName: string
  // SteamID64 of the linked account, or null when nothing is connected yet.
  // Connecting happens in settings; this page only reads the result of it, and
  // says where to go when there isn't one.
  steamId: string | null
  error?: string
  // Set when an earlier games import is still being matched or reviewed.
  pendingHref?: string
}

// Reads the connection rather than owning it: linking a Steam account is
// account state that outlives any one import, so it is managed in settings and
// this page is the import itself. What the import found is shown by the review
// page every import lands on, not here.
export function SteamImportPage(handle: Handle<SteamImportPageProps>) {
  return () => {
    const { displayName, steamId, error, pendingHref } = handle.props

    return (
      <Page
        heading="Import from Steam"
        displayName={displayName}
        back={{ href: routes.profile.import.href(), label: '← All imports' }}
      >
        {error && <p mix={css({ color: 'var(--danger)' })}>{error}</p>}

        {pendingHref && (
          <div mix={css({ fontSize: '14px', marginBottom: '12px' })}>
            You have a games import waiting. <Link href={pendingHref}>Pick it back up</Link> — save or discard
            it to import your library again.
          </div>
        )}

        {steamId ? (
          <>
            <p mix={css({ color: 'var(--soft)' })}>
              Connected to Steam account <code>{steamId}</code>. Importing brings in the games you own, using
              your Steam playtime to tell them apart: anything you've played is logged as played, and anything
              you've never launched goes on your want-to-play list.
            </p>
            <p mix={css({ fontSize: '13px', color: 'var(--muted)' })}>
              Soundtracks, demos and server tools are left out. Each game is looked up in the games catalog in
              the background — you can leave the page and come back — and nothing reaches your log until
              you've reviewed the matches and saved.
            </p>
            <div mix={css({ marginTop: '16px' })}>
              <form method="post" action={routes.profile.importGames.upload.href()}>
                <Button type="submit" variant="primary">
                  Import my library
                </Button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p mix={css({ color: 'var(--soft)' })}>
              No Steam account connected yet. Importing your library needs one, since the library is read from
              Steam rather than uploaded.
            </p>
            <p>
              <Link href={routes.profile.edit.index.href()}>Connect Steam in settings →</Link>
            </p>
          </>
        )}
      </Page>
    )
  }
}
