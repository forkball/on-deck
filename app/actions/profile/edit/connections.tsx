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

        {/* Ahead of the form, so the block reads as a state with a way to
            change it rather than a form with a footnote — and so the two
            buttons end up together at the bottom instead of with a paragraph
            wedged between them. */}
        {/* Kept to the part with consequences. That Letterboxd overwrites, and
            that it can now delete, is the thing someone would be annoyed not to
            have been told; how often it polls is not.

            What is read comes first, and it is stated before connecting as well
            as after, because it is the question both states are actually being
            asked: "will this bring my films across" before, and "why isn't this
            one here" after. Both have the same answer, and it is narrower than
            "reads your Letterboxd" sounds — the feed is the diary and nothing
            else, so a film that never got a diary entry is invisible to this no
            matter what else was done to it on Letterboxd.

            Named as what *is* carried rather than as a list of what isn't: the
            exclusions are open-ended (lists, watchlist, likes, follows, a bare
            rating), and only the diary is a promise we can keep. Lists and the
            watchlist are called out anyway — they are the two people expect to
            arrive, and the watchlist is the one that would otherwise read as a
            bug. */}
        {username ? (
          <>
            <p mix={NOTE}>
              Only diary entries come across — the films you've logged there, with the rating and
              review on each. Lists and your watchlist aren't read.
            </p>
            <p mix={NOTE}>
              New entries follow on their own, and so do changes and recent deletions — Letterboxd
              wins. Films you logged here yourself are never touched. The feed is re-read every
              quarter of an hour; <strong>Sync now</strong> reads it immediately and says what it
              found.
            </p>
          </>
        ) : (
          <p mix={NOTE}>
            Reads your public diary, no sign-in needed — only the films you've logged there, with
            the rating and review on each. Lists and your watchlist aren't read. For older films,
            use the <a href={routes.profile.importMovies.index.href()}>Letterboxd import</a>.
          </p>
        )}

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
          {/* The warnings the hint used to carry — that nothing proves the
              account is yours, that a private one publishes no feed — are both
              in the error the connect action returns when they bite, so they
              were being read by everyone to help the few who need them. */}
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
              defaultValue={username ?? ''}
            />
          </Field>
          {/* Both buttons submit this one form — Disconnect only overrides
              where to. A second <form> can't be nested to sit beside the
              first, and `formaction` is what HTML offers instead; the
              username field rides along in the body, which the disconnect
              action doesn't read. */}
          <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px' })}>
            <button type="submit">{username ? 'Save username' : 'Connect'}</button>
            {/* Rides the same form as the other two — see the note above — and
                like Disconnect it ignores the username field it carries. It
                syncs the name already stored, not whatever is half-typed in
                the box, so pressing it after an unsaved edit reads the diary
                you are actually connected to. */}
            {username && (
              <button type="submit" formaction={routes.profile.letterboxd.sync.href()}>
                Sync now
              </button>
            )}
            {username && (
              <button type="submit" formaction={routes.profile.letterboxd.disconnect.href()}>
                Disconnect
              </button>
            )}
          </div>
        </form>
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
