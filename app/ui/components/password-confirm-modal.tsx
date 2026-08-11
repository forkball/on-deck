import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PasswordGate } from '../../browser/password-gate.tsx'
import { Field } from '../shared/field.tsx'
import { Modal } from './modal.tsx'

const MODAL_ID = 'confirm-password'
const FIELD_NAME = 'current_password'

export interface PasswordConfirmModalProps {
  // Why the password is being asked for, e.g. "change your email".
  action: string
  // Fields whose change triggers the prompt. Omitted means the form always
  // needs a password — see PasswordGate.
  guardedFields?: string[]
  error?: string
  // Rendered already open, which is how the server puts a wrong password back
  // in front of someone on the no-JS path.
  defaultOpen?: boolean
}

// The single way a sensitive change is confirmed. Rendered *inside* the form
// it guards, so the password input is one of that form's fields and the
// button below submits the whole thing — no hidden copies of what was typed,
// and nothing to keep in sync.
//
// No trigger of its own, because neither path needs one: with JS the gate
// opens it on submit, and without JS the server renders it open once it sees
// a change that wants a password. A button asking to be pressed first would
// only be a third way in that nobody has a reason to use.
export function PasswordConfirmModal(handle: Handle<PasswordConfirmModalProps>) {
  return () => {
    const { action, guardedFields, error, defaultOpen } = handle.props

    return (
      <>
        <Modal id={MODAL_ID} title="Confirm it's you" defaultOpen={defaultOpen}>
          <p mix={css({ margin: '0 0 12px', fontSize: '14px', color: '#555' })}>
            Enter your current password to {action}.
          </p>
          <Field label="Current password" error={error}>
            <input type="password" name={FIELD_NAME} autocomplete="current-password" />
          </Field>
          <button type="submit" mix={css({ marginTop: '12px' })}>
            Confirm and save
          </button>
        </Modal>
        <PasswordGate modalId={MODAL_ID} passwordField={FIELD_NAME} guardedFields={guardedFields} />
      </>
    )
  }
}
