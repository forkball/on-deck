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
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '../../auth/password.ts'
import { ProfileEditPage } from './page.tsx'

const profileSchema = f.object({
  email: f.field(emailSchema),
  display_name: f.field(usernameSchema),
  bio: f.field(bioSchema),
  // The three password boxes carry no shape rules here: an empty one is a
  // valid submission (it means "unchanged"), and the current one is measured
  // against the stored hash rather than against today's rules. What they do
  // have to be is checked in order, which the action does below.
  current_password: f.field(s.defaulted(s.string(), '')),
  new_password: f.field(s.defaulted(s.string(), '')),
  confirm_password: f.field(s.defaulted(s.string(), '')),
})

// Whatever was typed, so a rejected submit comes back with the person's own
// text in the inputs rather than the stored row.
function submittedValues(formData: FormData) {
  return {
    email: String(formData.get('email') ?? ''),
    display_name: String(formData.get('display_name') ?? ''),
    bio: String(formData.get('bio') ?? ''),
  }
}

export default createController(routes.profile.edit, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      return context.render(
        <ProfileEditPage
          values={{
            email: auth.identity.email,
            display_name: auth.identity.display_name,
            bio: auth.identity.bio ?? '',
          }}
          displayName={displayLabel(auth.identity)}
        />,
      )
    },

    async update(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)

      // Every rejection puts the form back with what was typed in it — bar
      // the password boxes, which submittedValues deliberately never reads.
      const reject = (errors: Record<string, string>, status: number) =>
        context.render(
          <ProfileEditPage
            values={submittedValues(formData)}
            errors={errors}
            displayName={displayLabel(auth.identity)}
          />,
          { status },
        )

      const parsed = s.parseSafe(profileSchema, formData)
      if (!parsed.success) return reject(userFieldErrors(parsed.issues), 400)

      const db = context.get(Database)
      const { email, display_name, bio, current_password, new_password, confirm_password } = parsed.value

      const changingHandle =
        email !== auth.identity.email || display_name !== auth.identity.display_name
      // An empty box means "leave it alone", which is the only way this form
      // can offer a password change without demanding one on every save.
      const changingPassword = new_password !== ''

      // The two handles are how the account is reached — an email a reset can
      // be pointed at, a name other people find you under — and the password
      // is the account itself. Changing any of them means proving you own the
      // account rather than merely sitting at a browser someone left logged
      // in. A bio is only text, so editing one costs nothing.
      if (changingHandle || changingPassword) {
        const confirmed =
          current_password !== '' && (await verifyPassword(current_password, auth.identity.password_hash))

        if (!confirmed) {
          return reject(
            {
              current_password: current_password
                ? "That isn't your current password."
                : 'Enter your current password to confirm this change.',
            },
            403,
          )
        }
      }

      if (changingPassword) {
        if (new_password.length < PASSWORD_MIN_LENGTH) {
          return reject(
            { new_password: `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.` },
            400,
          )
        }
        // Confirmed rather than trusted: a typo here locks the account out,
        // and the input is masked, so nobody can proofread it.
        if (new_password !== confirm_password) {
          return reject({ confirm_password: "Those passwords don't match." }, 400)
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

      // One write, so a rejected password change can't leave a renamed
      // account behind it.
      await updateUserProfile(db, auth.identity.id, {
        email,
        display_name,
        bio,
        ...(changingPassword ? { password_hash: await hashPassword(new_password) } : {}),
      })

      return redirect(`${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
