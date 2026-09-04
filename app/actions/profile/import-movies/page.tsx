import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { LetterboxdImportForm } from '../../../browser/letterboxd-import-form.tsx'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Toast } from '../../../ui/components/toast.tsx'

export interface LetterboxdConnection {
  // The member name whose feed is being read, or null when nothing is connected.
  username: string | null
  justConnected: boolean
  // The connect form has no page of its own, so its failures arrive here.
  error?: string
}

export interface LetterboxdImportPageProps {
  displayName: string
  error?: string
  // Set when an earlier upload is still waiting to be matched or reviewed.
  pendingHref?: string
  connection: LetterboxdConnection
}

const PANEL = css({
  border: '1px solid #d9cfbe',
  borderRadius: '8px',
  padding: '16px 18px',
  marginBottom: '28px',
})

const NOTE = css({ fontSize: '13px', color: '#888' })

// The ongoing half of the page. The upload below it backfills history; this
// keeps up with it afterwards, and the two are worth seeing together.
function FeedConnection(handle: Handle<{ connection: LetterboxdConnection }>) {
  return () => {
    const { username, error } = handle.props.connection

    return (
      <section mix={PANEL}>
        <h2 mix={css({ marginTop: 0, fontSize: '16px' })}>Keep it up to date</h2>

        {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}

        {username ? (
          <>
            <p mix={css({ color: '#555' })}>
              Reading the public diary of <code>{username}</code>. New entries appear here when you
              next visit On Deck — there's nothing to run.
            </p>
            <p mix={NOTE}>
              Letterboxd is the source of truth for these films: a rating or review you change there
              replaces what's here. Editing one of them in On Deck won't last.
            </p>
            <form method="post" action={routes.profile.letterboxd.disconnect.href()}>
              <button type="submit">Disconnect</button>
            </form>
          </>
        ) : (
          <>
            <p mix={css({ color: '#555' })}>
              Your Letterboxd diary is public, so On Deck can read it without you signing in
              anywhere. Give it your username — the last part of your profile URL,
              <code>letterboxd.com/<strong>yourname</strong>/</code> — and new watches will follow
              on their own.
            </p>
            <form
              method="post"
              action={routes.profile.letterboxd.connect.href()}
              mix={css({ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' })}
            >
              <input
                type="text"
                name="username"
                placeholder="yourname"
                autocomplete="off"
                spellcheck={false}
                aria-label="Letterboxd username"
                mix={css({ padding: '6px 8px' })}
              />
              <button type="submit">Connect</button>
            </form>
            <p mix={NOTE}>
              Anyone's username works here — nothing proves the account is yours, so double-check
              the spelling. A private Letterboxd account publishes no feed and can't be read.
            </p>
          </>
        )}
      </section>
    )
  }
}

export function LetterboxdImportPage(handle: Handle<LetterboxdImportPageProps>) {
  return () => {
    const { displayName, error, pendingHref, connection } = handle.props

    return (
      <Document title="Import from Letterboxd | On Deck">
        <Nav authed={true} displayName={displayName} />
        {connection.justConnected && (
          <Toast message="Connected. Your recent films are on their way in." />
        )}
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Import from Letterboxd</h1>

          {pendingHref && (
            <div
              mix={css({
                border: '1px solid #d9cfbe',
                borderLeft: '4px solid #3E5C76',
                borderRadius: '8px',
                background: '#fbf4ea',
                padding: '12px 14px',
                marginBottom: '18px',
                fontSize: '14px',
              })}
            >
              You have an import waiting. <a href={pendingHref}>Pick it back up</a> — uploading again
              starts over.
            </div>
          )}

          <FeedConnection connection={connection} />

          <h2 mix={css({ fontSize: '16px' })}>Bring across everything you've logged</h2>

          <p mix={css({ color: '#555' })}>
            The feed only carries your fifty most recent films, so your back catalogue comes across
            as a file. Export your data from Letterboxd (Settings → Data → Export) and upload the
            resulting <code>.zip</code>, unopened — ratings and reviews live in separate files
            inside, and both come across in one import.
          </p>

          <p mix={css({ color: '#555' })}>
            Exporting from Letterboxd's app is unreliable — if the export doesn't come through,
            open letterboxd.com in a mobile browser or on a desktop computer instead and export
            from there.
          </p>

          <LetterboxdImportForm
            uploadHref={routes.profile.importMovies.upload.href()}
            accept=".zip"
            error={error}
          />

          <p mix={css({ fontSize: '13px', color: '#3E5C76' })}>
            Nothing is saved until you've seen what we matched.
          </p>
        </main>
      </Document>
    )
  }
}
