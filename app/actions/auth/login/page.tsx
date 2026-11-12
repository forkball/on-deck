import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, Link, TextInput } from '../../../ui/shared/form-controls.tsx'

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
          {/* "Forgotten?" sits on the label's row, pinned to its right end.
                It is a sibling of the Field rather than inside it: inside the
                <label>, a screen reader would read it as part of the field's
                name. The aria-label is the whole question, which "Forgotten?"
                on its own doesn't say when read out of context. */}
          <div mix={css({ position: 'relative' })}>
            <Field label="Password">
              <TextInput type="password" name="password" required />
            </Field>
            <Link
              variant="small"
              href={routes.auth.forgot.index.href()}
              aria-label="Forgot your password?"
              mix={css({ position: 'absolute', top: 0, right: 0 })}
            >
              Forgotten?
            </Link>
          </div>
          <Button type="submit" variant="primary">
            Log in
          </Button>
        </form>
        <p>
          Need an account? <Link href={routes.auth.signup.index.href()}>Sign up</Link>
        </p>
      </Page>
    )
  }
}
