import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Field } from '../../../assets/ui/field.tsx'

export interface SignupPageProps {
  error?: string
  values?: Record<string, string>
}

export function SignupPage(handle: Handle<SignupPageProps>) {
  return () => {
    const { error, values } = handle.props

    return (
      <Document title="Sign up | On Deck">
        <Nav authed={false} />
        <main mix={css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Sign up</h1>
          {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
          <form
            method="post"
            action={routes.auth.signup.action.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
          >
            <Field label="Email">
              <input type="email" name="email" required defaultValue={values?.email ?? ''} />
            </Field>
            <Field label="Password (min 8 characters)">
              <input type="password" name="password" required minLength={8} />
            </Field>
            <Field label="Display name (optional)">
              <input type="text" name="display_name" defaultValue={values?.display_name ?? ''} />
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
