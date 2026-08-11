import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Field } from '../../../ui/shared/field.tsx'

export interface SignupPageProps {
  // Keyed by field name, so each message lands under the input it's about.
  errors?: Record<string, string>
  values?: Record<string, string>
}

export function SignupPage(handle: Handle<SignupPageProps>) {
  return () => {
    const { errors, values } = handle.props

    return (
      <Document title="Sign up | On Deck">
        <Nav authed={false} />
        <main mix={css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Sign up</h1>
          <form
            method="post"
            action={routes.auth.signup.action.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
          >
            <Field label="Email" error={errors?.email}>
              <input type="email" name="email" required defaultValue={values?.email ?? ''} />
            </Field>
            <Field label="Password (min 8 characters)" error={errors?.password}>
              <input type="password" name="password" required minLength={8} />
            </Field>
            <Field label="Username" error={errors?.display_name} hint={USERNAME_HINT}>
              <input
                type="text"
                name="display_name"
                required
                maxLength={USERNAME_MAX_LENGTH}
                defaultValue={values?.display_name ?? ''}
              />
            </Field>
            <button type="submit">Create account</button>
          </form>
          <p>
            Already have an account? <a href={routes.auth.login.index.href()}>Log in</a>
          </p>
        </main>
      </Document>
    )
  }
}
