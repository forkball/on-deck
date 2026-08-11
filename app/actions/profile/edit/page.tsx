import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { BIO_MAX_LENGTH, USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../../data/users.ts'
import { PASSWORD_MIN_LENGTH } from '../../auth/password.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Field } from '../../../ui/shared/field.tsx'

export interface ProfileEditPageProps {
  // What to put back in the inputs: the stored row on a first load, whatever
  // was typed on a rejected submit.
  values: { email: string; display_name: string; bio: string }
  errors?: Record<string, string>
  displayName: string
}

export function ProfileEditPage(handle: Handle<ProfileEditPageProps>) {
  return () => {
    const { values, errors, displayName } = handle.props

    return (
      <Document title="Edit profile | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '480px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Edit profile</h1>
          <form
            method="post"
            action={routes.profile.edit.update.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
          >
            <input type="hidden" name="_method" value="PUT" />
            <Field
              label="Email"
              error={errors?.email}
              hint="Used to log in. Nobody else sees it unless you have no username."
            >
              <input type="email" name="email" required defaultValue={values.email} />
            </Field>
            <Field label="Username" error={errors?.display_name} hint={USERNAME_HINT}>
              <input
                type="text"
                name="display_name"
                required
                maxLength={USERNAME_MAX_LENGTH}
                defaultValue={values.display_name}
              />
            </Field>
            <Field
              label="Bio"
              error={errors?.bio}
              hint="Just for other people to read — it has no effect on your recommendations."
            >
              <textarea
                name="bio"
                rows={4}
                maxLength={BIO_MAX_LENGTH}
                defaultValue={values.bio}
                placeholder="Tell people a bit about yourself…"
              />
            </Field>
            <h2 mix={css({ margin: '8px 0 0', fontSize: '16px' })}>Password</h2>
            {/* One form, not two: the same confirmation covers a handle
                change and a password change, and a single save means a
                rejected password can't leave a renamed account behind it.
                None of the three is `required` — a bio-only edit needs no
                password at all, and the browser can't know which kind of
                edit this is until it's submitted. The server does. */}
            <Field
              label="Current password"
              error={errors?.current_password}
              hint="Needed to change your email, username or password."
            >
              <input type="password" name="current_password" autocomplete="current-password" />
            </Field>
            <Field
              label="New password"
              error={errors?.new_password}
              hint={`Leave blank to keep your current one. At least ${PASSWORD_MIN_LENGTH} characters.`}
            >
              <input
                type="password"
                name="new_password"
                minLength={PASSWORD_MIN_LENGTH}
                autocomplete="new-password"
              />
            </Field>
            <Field label="Confirm new password" error={errors?.confirm_password}>
              <input type="password" name="confirm_password" autocomplete="new-password" />
            </Field>
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px' })}>
              <button type="submit">Save changes</button>
              <a href={routes.profile.index.href()}>Cancel</a>
            </div>
          </form>
        </main>
      </Document>
    )
  }
}
