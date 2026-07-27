import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { stackedLabel } from '../../../ui/components/styles.ts'

export function LoginPage(handle: Handle<{ error?: string }>) {
  return () => {
    const { error } = handle.props

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
            <label mix={stackedLabel}>
              Email
              <input type="email" name="email" required />
            </label>
            <label mix={stackedLabel}>
              Password
              <input type="password" name="password" required />
            </label>
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
