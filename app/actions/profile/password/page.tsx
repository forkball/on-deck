import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { Page } from '../../../ui/components/page.tsx'
import { PasswordConfirmModal } from '../../../ui/components/password-confirm-modal.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { PASSWORD_MIN_LENGTH } from '../../auth/password.ts'

export interface ProfilePasswordPageProps {
  errors?: Record<string, string>
  // Set once the new password is acceptable and only the confirmation is
  // outstanding, so the modal comes back open.
  confirming?: boolean
  displayName: string
}

export function ProfilePasswordPage(handle: Handle<ProfilePasswordPageProps>) {
  return () => {
    const { errors, confirming, displayName } = handle.props

    return (
      // This page is only reached from the edit form, and since it lost its
      // Cancel button the back link is the only way back out.
      <Page
        title="Change password"
        heading="Change password"
        back={{ href: routes.profile.edit.index.href(), label: '← Back to edit profile' }}
        displayName={displayName}
      >
        <form
          method="post"
          action={routes.profile.password.update.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px' })}
        >
          <input type="hidden" name="_method" value="PUT" />
          <Field
            label="New password"
            error={errors?.new_password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          >
            <input
              type="password"
              name="new_password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autocomplete="new-password"
            />
          </Field>
          {/* Asked for twice because a typo here locks the account out and
                the input is masked, so nobody can proofread it. */}
          <Field label="Confirm new password" error={errors?.confirm_password}>
            <input type="password" name="confirm_password" required autocomplete="new-password" />
          </Field>
          {/* No guarded fields: on this form every save needs the current
                password, so the modal opens on any submit. */}
          <PasswordConfirmModal
            action="change your password"
            error={errors?.current_password}
            defaultOpen={confirming}
          />
          <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px' })}>
            <button type="submit">Change password</button>
          </div>
        </form>
      </Page>
    )
  }
}
