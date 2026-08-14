import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { SteamImportResult } from '../../../data/imports/steam.ts'
import { Toast } from '../../../ui/components/toast.tsx'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'

export interface SteamImportPageProps {
  displayName: string
  // SteamID64 of the linked account, or null when nothing is connected yet.
  steamId: string | null
  connected?: boolean
  // The controller turns failure codes into wording before they get here.
  error?: string
  result?: SteamImportResult
}

// Counts are split because a Steam library imports into two statuses, which no
// other importer does: "imported 300 games" would hide that most landed on the
// want-to-play pile.
function ImportSummary(handle: Handle<{ result: SteamImportResult }>) {
  return () => {
    const { result } = handle.props

    return (
      <>
        <p mix={css({ color: '#15803d' })}>
          Imported {result.imported} games — {result.played} you've played, {result.unplayed} you own but
          haven't started.
        </p>
        {result.skipped > 0 && (
          <p mix={css({ fontSize: '13px', color: '#888' })}>
            Skipped {result.skipped} non-game items in your library, like soundtracks, demos and server
            tools.
          </p>
        )}
        {result.notFound.length > 0 && (
          <section mix={css({ marginTop: '24px' })}>
            <h2>Couldn't match {result.notFound.length}</h2>
            <p mix={css({ fontSize: '13px', color: '#888' })}>
              These are in your Steam library but had no confident match in the games catalog — usually
              something listed there under a different name. You can add any of them by searching for it.
            </p>
            <ul
              mix={css({
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              })}
            >
              {result.notFound.map((title) => (
                <li key={title} mix={css({ fontSize: '14px' })}>
                  {title}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p mix={css({ marginTop: '24px' })}>
          <a href={routes.profile.index.href()}>Back to your profile →</a>
        </p>
      </>
    )
  }
}

// Carries the connection state too, since the source is a linked account
// rather than an uploaded file.
export function SteamImportPage(handle: Handle<SteamImportPageProps>) {
  return () => {
    const { displayName, steamId, connected, error, result } = handle.props

    return (
      <Document title="Import from Steam | On Deck">
        <Nav authed={true} displayName={displayName} />
        {connected && <Toast message="Steam account connected." />}
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Steam</h1>

          {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}

          {result ? (
            <ImportSummary result={result} />
          ) : steamId ? (
            <>
              <p mix={css({ color: '#555' })}>
                Connected to Steam account <code>{steamId}</code>. Importing brings in the games you own,
                using your Steam playtime to tell them apart: anything you've played is logged as played,
                and anything you've never launched goes on your want-to-play list.
              </p>
              <p mix={css({ fontSize: '13px', color: '#888' })}>
                A large library takes a few minutes — each game is looked up individually. Leave the tab
                open until it finishes.
              </p>
              <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '16px' })}>
                <form method="post" action={routes.profile.importGames.upload.href()}>
                  <button type="submit">Import my library</button>
                </form>
                <form method="post" action={routes.profile.steam.disconnect.href()}>
                  <button type="submit">Disconnect</button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p mix={css({ color: '#555' })}>
                Sign in through Steam to import your library. On Deck only reads which games you own and
                how long you've played them — it can't post or change anything on your account.
              </p>
              <p mix={css({ color: '#555' })}>
                Your Steam profile's <strong>Game details</strong> setting needs to be Public, otherwise
                Steam won't share the list even after you've signed in.
              </p>
              {/*
                `rmx-document` is load-bearing here for a different reason than
                on the media tabs. This href is same-origin, so the framework
                intercepts the click and fetches it as a frame — but the route
                answers with a 303 to steamcommunity.com, and a fetch follows
                that redirect cross-origin, where Steam sends no CORS headers.
                The browser blocks it and the sign-in never starts. Leaving the
                origin is a document navigation, not a data fetch.
              */}
              <p>
                <a href={routes.profile.steam.connect.href()} rmx-document="">
                  Sign in through Steam →
                </a>
              </p>
            </>
          )}
        </main>
      </Document>
    )
  }
}
