import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'

export function LoginPage(handle: Handle<{ error?: string; next?: string }>) {
  return () => {
    const { error, next } = handle.props

    return (
      <Page title="Log in" heading="Log in" width="narrow" authed={false}>
        {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
        <form
          method="post"
          action={routes.auth.login.action.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          {next && <input type="hidden" name="return_to" value={next} />}
          <Field label="Email or username">
            <input type="text" name="identifier" required />
          </Field>
          <Field label="Password">
            <input type="password" name="password" required />
          </Field>
          <button type="submit">Log in</button>
        </form>
        <p>
          Need an account? <a href={routes.auth.signup.index.href()}>Sign up</a>
        </p>
      </Page>
    )
  }
}
