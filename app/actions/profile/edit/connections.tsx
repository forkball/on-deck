import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Field } from '../../../ui/shared/field.tsx'

// The accounts On Deck reads from, on the page where the rest of the account
// lives. They used to sit on their own import pages — beside the uploader that
// backfills the same library — which put a standing connection inside a flow
// that is over the moment a file is read, and left no way to correct a
// Letterboxd username short of disconnecting and starting again.
//
// Both are rendered here even though only one is a real sign-in: what they have
// in common is that On Deck keeps reading them after you walk away, which is
// the thing worth finding in one place.

export interface LetterboxdConnection {
  // The member name whose feed is being read, or null when nothing is connected.
  username: string | null
  justConnected: boolean
  // The connect form has no page of its own, so its failures arrive here.
  error?: string
}

export interface SteamConnection {
  // SteamID64 of the linked account, or null when nothing is connected yet.
  steamId: string | null
  justConnected: boolean
  error?: string
}

export interface ConnectionsProps {
  // Null when the feed sync is gated off, which takes the whole Letterboxd
  // block off the page rather than showing something nobody can use.
  letterboxd: LetterboxdConnection | null
  steam: SteamConnection
}

const PANEL = css({
  border: '1px solid #d9cfbe',
  borderRadius: '8px',
  padding: '16px 18px',
  marginBottom: '16px',
})

const NOTE = css({ fontSize: '13px', color: '#888' })

const ERROR = css({ color: '#b91c1c' })

function LetterboxdBlock(handle: Handle<{ connection: LetterboxdConnection }>) {
  return () => {
    const { username, error } = handle.props.connection

    return (
      <section mix={PANEL}>
        <h3 mix={css({ marginTop: 0, fontSize: '15px' })}>Letterboxd</h3>

        {error && <p mix={ERROR}>{error}</p>}

        {/* One form either way, and the same action behind it. Connecting and
            changing the name are the same act — naming the diary to read — so
            the connected state is this field with a value in it rather than a
            separate display that has to be dismantled before it can be
            corrected. */}
        <form
          method="post"
          action={routes.profile.letterboxd.connect.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          <Field
            label="Letterboxd username"
            hint="The last part of your profile URL — letterboxd.com/yourname/. Nothing proves the account is yours, so check the spelling. A private account publishes no feed and can't be read."
          >
            <input
              type="text"
              name="username"
              placeholder="yourname"
              autocomplete="off"
              spellcheck={false}
              defaultValue={username ?? ''}
            />
          </Field>
          <div>
            <button type="submit">{username ? 'Save username' : 'Connect'}</button>
          </div>
        </form>

        {username ? (
          <>
            <p mix={NOTE}>
              Reading the public diary of <code>{username}</code>. New entries arrive on their own —
              there's nothing to run. Letterboxd is the source of truth for these films: a rating or
              review you change there replaces what's here, and a recent diary entry you delete there
              is removed here too. Films you logged in On Deck yourself are never touched.
            </p>
            <form
              method="post"
              action={routes.profile.letterboxd.disconnect.href()}
              mix={css({ marginTop: '12px' })}
            >
              <button type="submit">Disconnect</button>
            </form>
          </>
        ) : (
          <p mix={NOTE}>
            Your Letterboxd diary is public, so On Deck can read it without you signing in anywhere.
            To bring across everything you've already logged, use the{' '}
            <a href={routes.profile.importMovies.index.href()}>Letterboxd import</a> — the feed only
            carries your fifty most recent films.
          </p>
        )}
      </section>
    )
  }
}

function SteamBlock(handle: Handle<{ connection: SteamConnection }>) {
  return () => {
    const { steamId, error } = handle.props.connection

    return (
      <section mix={PANEL}>
        <h3 mix={css({ marginTop: 0, fontSize: '15px' })}>Steam</h3>

        {error && <p mix={ERROR}>{error}</p>}

        {steamId ? (
          <>
            <p mix={css({ margin: '0 0 12px', color: '#555' })}>
              Connected to Steam account <code>{steamId}</code>.
            </p>
            <p mix={NOTE}>
              Unlike Letterboxd, nothing is read until you ask for it —{' '}
              <a href={routes.profile.importGames.index.href()}>import your library</a> to bring your
              games across.
            </p>
            <form
              method="post"
              action={routes.profile.steam.disconnect.href()}
              mix={css({ marginTop: '12px' })}
            >
              <button type="submit">Disconnect</button>
            </form>
          </>
        ) : (
          <>
            <p mix={css({ margin: '0 0 12px', color: '#555' })}>
              Sign in through Steam to import the games you own. On Deck only reads which games you
              own and how long you've played them — it can't post or change anything on your account.
            </p>
            <p mix={NOTE}>
              Your Steam profile's <strong>Game details</strong> setting needs to be Public, otherwise
              Steam won't share the list even after you've signed in.
            </p>
            {/*
              `rmx-document` is load-bearing. This href is same-origin, so the
              framework intercepts the click and fetches it as a frame — but the
              route answers with a 303 to steamcommunity.com, and a fetch follows
              that redirect cross-origin, where Steam sends no CORS headers. The
              browser blocks it and the sign-in never starts. Leaving the origin
              is a document navigation, not a data fetch.
            */}
            <p mix={css({ marginTop: '12px' })}>
              <a href={routes.profile.steam.connect.href()} rmx-document="">
                Sign in through Steam →
              </a>
            </p>
          </>
        )}
      </section>
    )
  }
}

export function Connections(handle: Handle<ConnectionsProps>) {
  return () => {
    const { letterboxd, steam } = handle.props

    return (
      <section mix={css({ marginTop: '40px', maxWidth: '480px' })}>
        <h2>Connected accounts</h2>
        <p mix={css({ margin: '0 0 16px', color: '#555' })}>
          Libraries On Deck reads from. Disconnecting one stops the reading — it leaves everything
          already in your log exactly where it is.
        </p>

        {letterboxd && <LetterboxdBlock connection={letterboxd} />}
        <SteamBlock connection={steam} />
      </section>
    )
  }
}
