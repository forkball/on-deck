import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Field } from '../../../ui/shared/field.tsx'

export function LoginPage(handle: Handle<{ error?: string; next?: string }>) {
  return () => {
    const { error, next } = handle.props

    return (
      <Document title="Log in | On Deck">
        <Nav authed={false} />
        <main mix={css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Log in</h1>
          {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
          <form
            method="post"
            action={routes.auth.login.action.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
          >
            {next && <input type="hidden" name="return_to" value={next} />}
            <Field label="Email">
              <input type="email" name="email" required />
            </Field>
            <Field label="Password">
              <input type="password" name="password" required />
            </Field>
            <button type="submit">Log in</button>
          </form>
          <p>
            Need an account? <a href={routes.auth.signup.index.href()}>Sign up</a>
          </p>
        </main>
      </Document>
    )
  }
}
