import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, TextInput } from '../../../ui/shared/form-controls.tsx'

export interface SignupPageProps {
  // Keyed by field name, so each message lands under the input it's about.
  errors?: Record<string, string>
  values?: Record<string, string>
}

export function SignupPage(handle: Handle<SignupPageProps>) {
  return () => {
    const { errors, values } = handle.props

    return (
      <Page heading="Sign up" width="narrow">
        <form
          method="post"
          action={routes.auth.signup.action.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          <Field label="Email" error={errors?.email}>
            <TextInput type="email" name="email" required defaultValue={values?.email ?? ''} />
          </Field>
          <Field label="Password (min 8 characters)" error={errors?.password}>
            <TextInput type="password" name="password" required minLength={8} />
          </Field>
          <Field label="Username" error={errors?.display_name} hint={USERNAME_HINT}>
            <TextInput
              name="display_name"
              required
              maxLength={USERNAME_MAX_LENGTH}
              defaultValue={values?.display_name ?? ''}
            />
          </Field>
          <Button type="submit" variant="primary">
            Create account
          </Button>
        </form>
        <p>
          Already have an account? <a href={routes.auth.login.index.href()}>Log in</a>
        </p>
      </Page>
    )
  }
}
