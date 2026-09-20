import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import type { User } from '../../../data/schema.ts'
import {
  bioSchema,
  displayLabel,
  emailSchema,
  findUserByEmail,
  findUserByUsername,
  updateUserProfile,
  userFieldErrors,
  usernameSchema,
} from '../../../data/users.ts'
import { letterboxdSyncAvailableTo } from '../../../data/imports/letterboxdFeed.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { verifyPassword } from '../../auth/password.ts'
import { profileSettingsFor } from '../../../data/recommendations/tasteProfile.ts'
import type { ConnectionsProps } from './connections.tsx'
import { PROFILE_TABS, ProfileEditPage, type ProfileTab } from './page.tsx'

const profileSchema = f.object({
  email: f.field(emailSchema),
  display_name: f.field(usernameSchema),
  bio: f.field(bioSchema),
  // Checkboxes send nothing at all when unchecked, rather than "off" — the
  // missing key is what `defaulted` is catching here.
  is_private: f.field(s.defaulted(s.string(), '').transform((value) => value !== '')),
  // No shape rules: an empty box is a valid submission — a bio-only edit
  // needs no password — and a filled one is measured against the stored hash
  // rather than against today's rules. Whether it was needed is decided
  // below, once it's known what actually changed.
  current_password: f.field(s.defaulted(s.string(), '')),
})

// The Steam OpenID callback can only redirect with a code, so the wording lives
// here rather than travelling through the URL.
function steamError(code: string | null): string | undefined {
  if (!code) return undefined
  if (code === 'taken') return 'That Steam account is already connected to another profile.'
  return "Couldn't verify that Steam sign-in. Try connecting again."
}

// Both connections read off the identity and the query string the connect
// actions redirect back with. Built for every render of this page, the rejected
// submits included — the panels are part of the page, not of the form that
// failed, and dropping them on a bad password would be a strange thing to do to
// someone who mistyped one.
function connectionsFor(identity: User, url: URL): ConnectionsProps {
  return {
    letterboxd: letterboxdSyncAvailableTo(identity)
      ? {
          username: identity.letterboxd_username ?? null,
          justConnected: url.searchParams.get('letterboxdConnected') === '1',
          error: url.searchParams.get('letterboxdError') ?? undefined,
          notice: url.searchParams.get('letterboxdNotice') ?? undefined,
        }
      : null,
    steam: {
      steamId: identity.steam_id ?? null,
      persona: identity.steam_persona ?? null,
      justConnected: url.searchParams.get('steamConnected') === '1',
      error: steamError(url.searchParams.get('steamError')),
    },
  }
}

// Which pane to open on. Read off the query string the other actions redirect
// with, so a save or a failed connect comes back to the thing it was about
// rather than to the profile form.
function activeTab(url: URL): ProfileTab | undefined {
  const tab = url.searchParams.get('tab')
  return tab != null && tab in PROFILE_TABS ? (tab as ProfileTab) : undefined
}

// Whatever was typed, so a rejected submit comes back with the person's own
// text (and checkbox state) in the inputs rather than the stored row.
function submittedValues(formData: FormData) {
  return {
    email: String(formData.get('email') ?? ''),
    display_name: String(formData.get('display_name') ?? ''),
    bio: String(formData.get('bio') ?? ''),
    is_private: formData.get('is_private') != null,
  }
}

export default createController(routes.profile.edit, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)

      return context.render(
        <ProfileEditPage
          values={{
            email: auth.identity.email,
            display_name: auth.identity.display_name,
            bio: auth.identity.bio ?? '',
            is_private: auth.identity.is_private,
          }}
          settings={profileSettingsFor(auth.identity)}
          saved={context.url.searchParams.get('saved') === '1'}
          displayName={displayLabel(auth.identity)}
          connections={connectionsFor(auth.identity, context.url)}
          activeTab={activeTab(context.url)}
        />,
      )
    },

    async update(context) {
      const auth = context.get(Auth)

      const formData = context.get(FormData)

      // Every rejection puts the form back with what was typed in it — bar
      // the password box, which submittedValues deliberately never reads.
      const reject = (errors: Record<string, string>, status: number, confirming = false) =>
        context.render(
          <ProfileEditPage
            values={submittedValues(formData)}
            errors={errors}
            confirming={confirming}
            settings={profileSettingsFor(auth.identity)}
            displayName={displayLabel(auth.identity)}
            connections={connectionsFor(auth.identity, context.url)}
            // This form is the profile pane, and it is the one that failed —
            // so the errors are rendered where the fields carrying them are.
            activeTab={PROFILE_TABS.profile}
          />,
          { status },
        )

      const parsed = s.parseSafe(profileSchema, formData)
      if (!parsed.success) return reject(userFieldErrors(parsed.issues), 400)

      const db = context.get(Database)
      const { email, display_name, bio, is_private, current_password } = parsed.value

      // The two handles are how the account is reached — an email a reset can
      // be pointed at, a name other people find you under — so changing
      // either means proving you own the account rather than merely sitting
      // at a browser someone left logged in. A bio is only text, so editing
      // one costs nothing. (The password itself is changed on its own page.)
      if (email !== auth.identity.email || display_name !== auth.identity.display_name) {
        const confirmed =
          current_password !== '' && (await verifyPassword(current_password, auth.identity.password_hash))

        if (!confirmed) {
          // Reopened rather than merely flagged: with JS off the modal is the
          // only place the box exists, so a closed one would hide the error
          // behind a trigger nobody was told to look for.
          return reject(
            { current_password: current_password ? "That isn't your current password." : '' },
            403,
            true,
          )
        }
      }

      // Both columns are unique, so this is checked twice over: here, to say
      // which field collided, and by the index, which is what actually holds
      // under a race.
      const errors: Record<string, string> = {}
      if (await findUserByEmail(db, email, auth.identity.id)) {
        errors.email = 'An account with that email already exists.'
      }
      if (await findUserByUsername(db, display_name, auth.identity.id)) {
        errors.display_name = 'That username is already taken.'
      }

      if (Object.keys(errors).length > 0) return reject(errors, 409)

      await updateUserProfile(db, auth.identity.id, { email, display_name, bio, is_private })

      return redirect(`${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
