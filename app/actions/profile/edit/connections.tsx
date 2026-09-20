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
  // What the last Sync now found, when that is what brought us back here.
  notice?: string
}

export interface SteamConnection {
  // SteamID64 of the linked account, or null when nothing is connected yet.
  steamId: string | null
  // What Steam calls that account. Null when Steam wouldn't say — the id is
  // shown on its own then, which is worse to read but never wrong.
  persona: string | null
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
    const { username, error, notice } = handle.props.connection

    return (
      <section mix={PANEL}>
        <h3 mix={css({ marginTop: 0, fontSize: '15px' })}>Letterboxd</h3>

        {error && <p mix={ERROR}>{error}</p>}
        {notice && <p mix={css({ margin: '0 0 12px', color: '#555' })}>{notice}</p>}

        {/* Connected and disconnected are two states, not one form with a
            different button on it: the field is for naming a diary that isn't
            named yet, so once one is, it goes away and what's left is acting
            on the connection. Same shape as Steam below.

            The cost is that correcting a typo means disconnecting and
            connecting again — the connect action would take a new name
            perfectly well, there is just nowhere to type one. */}
        {/* Kept to the part with consequences, and no longer than it takes to
            say: what is read, that Letterboxd wins, and how to make it happen
            now. What is read comes first in both states, because it is the
            question each is being asked — "will this bring my films across"
            before, "why isn't this one here" after — and the answer is
            narrower than "reads your Letterboxd" sounds.

            Stated as what is carried rather than as a list of what isn't; the
            exclusions are open-ended and only the diary is a promise the sync
            can keep. Lists and the watchlist are named anyway, being the two
            people expect to arrive. */}
        {username ? (
          <>
            <p mix={css({ margin: '0 0 12px', color: '#555' })}>
              Reading the public diary of <code>{username}</code>.
            </p>
            <p mix={NOTE}>
              Diary entries only — logged films, with their rating and review. Lists and your
              watchlist aren't read.
            </p>
            <p mix={NOTE}>
              Edits and deletions follow too, and Letterboxd wins. Films you logged here are never
              touched. Re-read every 15 minutes, or press <strong>Sync now</strong>.
            </p>

            {/* Sync is the form's own action and Disconnect overrides it,
                rather than two forms: nesting is not allowed, and `formaction`
                is what HTML offers instead. Nothing is submitted with either —
                both act on the username already stored. */}
            <form
              method="post"
              action={routes.profile.letterboxd.sync.href()}
              mix={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginTop: '12px' })}
            >
              <button type="submit">Sync now</button>
              <button type="submit" formaction={routes.profile.letterboxd.disconnect.href()}>
                Disconnect
              </button>
            </form>
          </>
        ) : (
          <>
            <p mix={NOTE}>
              Reads your public diary, no sign-in needed — diary entries only, with their rating
              and review. Lists and your watchlist aren't read. For older films, use the{' '}
              <a href={routes.profile.importMovies.index.href()}>Letterboxd import</a>.
            </p>
            <form
              method="post"
              action={routes.profile.letterboxd.connect.href()}
              mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
            >
              {/* The warnings the hint used to carry — that nothing proves the
                  account is yours, that a private one publishes no feed — are
                  both in the error the connect action returns when they bite,
                  so they were being read by everyone to help the few who need
                  them. */}
              <Field
                label="Letterboxd username"
                hint="The last part of your profile URL — letterboxd.com/yourname/"
              >
                <input
                  type="text"
                  name="username"
                  placeholder="yourname"
                  autocomplete="off"
                  spellcheck={false}
                />
              </Field>
              <div>
                <button type="submit">Connect</button>
              </div>
            </form>
          </>
        )}
      </section>
    )
  }
}

function SteamBlock(handle: Handle<{ connection: SteamConnection }>) {
  return () => {
    const { steamId, persona, error } = handle.props.connection

    return (
      <section mix={PANEL}>
        <h3 mix={css({ marginTop: 0, fontSize: '15px' })}>Steam</h3>

        {error && <p mix={ERROR}>{error}</p>}

        {steamId ? (
          <>
            {/* The name when Steam gives one, with the id kept underneath in
                small print: the name answers "is this my account", and the id
                is what to quote when something needs identifying exactly. */}
            <p mix={css({ margin: '0 0 4px', color: '#555' })}>
              {persona ? (
                <>
                  Connected as <strong>{persona}</strong>.
                </>
              ) : (
                <>
                  Connected to Steam account <code>{steamId}</code>.
                </>
              )}
            </p>
            {persona && (
              <p mix={css({ margin: '0 0 12px', fontSize: '12px', color: '#888' })}>
                <code>{steamId}</code>
              </p>
            )}
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

    // Inside a tab panel the bar above is the separator, so this carries no
    // top margin of its own.
    return (
      <section mix={css({ maxWidth: '480px' })}>
        <h2 mix={css({ marginTop: 0 })}>Connected accounts</h2>
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
