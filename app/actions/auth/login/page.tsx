import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, TextInput } from '../../../ui/shared/form-controls.tsx'

export function LoginPage(handle: Handle<{ error?: string; next?: string }>) {
  return () => {
    const { error, next } = handle.props

    return (
      <Page heading="Log in" width="narrow">
        {error && <p mix={css({ color: 'var(--danger)' })}>{error}</p>}
        <form
          method="post"
          action={routes.auth.login.action.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          {next && <input type="hidden" name="return_to" value={next} />}
          <Field label="Email or username">
            <TextInput name="identifier" required />
          </Field>
          <Field label="Password">
            <TextInput type="password" name="password" required />
          </Field>
          <Button type="submit" variant="primary">
            Log in
          </Button>
        </form>
        <p>
          Need an account? <a href={routes.auth.signup.index.href()}>Sign up</a>
        </p>
      </Page>
    )
  }
}
