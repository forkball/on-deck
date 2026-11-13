import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Button, ButtonLink, TextInput } from '../../../ui/shared/form-controls.tsx'
import { PASSWORD_MIN_LENGTH } from '../password.ts'

export interface ResetPasswordPageProps {
  // Null when the link can't be used — malformed, unknown, used or expired,
  // which the page doesn't tell apart: none of them can be fixed but by
  // asking for a new one.
  token: string | null
  errors?: Record<string, string>
}

export function ResetPasswordPage(handle: Handle<ResetPasswordPageProps>) {
  return () => {
    const { token, errors } = handle.props

    if (!token) {
      return (
        <Page heading="That link has expired" width="narrow">
          <p>Reset links work once and expire after an hour. Ask for a new one and use the latest email.</p>
          <ButtonLink href={routes.auth.forgot.index.href()}>Send a new link</ButtonLink>
        </Page>
      )
    }

    return (
      <Page heading="Choose a new password" width="narrow">
        <form
          method="post"
          action={routes.auth.reset.action.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          <input type="hidden" name="token" value={token} />
          <Field
            label="New password"
            error={errors?.new_password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          >
            <TextInput
              type="password"
              name="new_password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autocomplete="new-password"
            />
          </Field>
          {/* Asked for twice for the reason the profile form asks twice: the
                input is masked, so a typo can't be proofread. */}
          <Field label="Confirm new password" error={errors?.confirm_password}>
            <TextInput type="password" name="confirm_password" required autocomplete="new-password" />
          </Field>
          <Button type="submit" variant="primary">
            Set password and log in
          </Button>
        </form>
      </Page>
    )
  }
}
