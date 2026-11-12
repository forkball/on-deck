import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, Link, TextInput } from '../../../ui/shared/form-controls.tsx'

export function ForgotPasswordPage(handle: Handle<{ sent?: boolean }>) {
  return () => {
    const { sent } = handle.props

    return (
      <Page heading="Forgot your password?" width="narrow">
        {sent ? (
          // Worded as a conditional on purpose, and shown whatever was typed:
          // saying "no account with that email" would let anyone check which
          // addresses are registered here.
          <p>
            If that matches an account, we've sent a link to its email address. It works once and expires in
            an hour — check your spam folder if it doesn't turn up in a few minutes.
          </p>
        ) : (
          <>
            <p>
              Enter the email or username you log in with, and we'll email you a link to choose a new
              password.
            </p>
            <form
              method="post"
              action={routes.auth.forgot.action.href()}
              mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
            >
              <Field label="Email or username">
                <TextInput name="identifier" required autocomplete="username" />
              </Field>
              <Button type="submit" variant="primary">
                Email me a link
              </Button>
            </form>
          </>
        )}
        <p>
          <Link href={routes.auth.login.index.href()}>Back to log in</Link>
        </p>
      </Page>
    )
  }
}
