import { html } from 'remix/html-template'

import type { MailMessage } from '../mail.ts'

// The reset email itself. Database-free like tokens.ts, so what it says is
// tested without sending anything.
export function resetEmail(to: string, name: string, link: string): MailMessage {
  const text = [
    `Hi ${name},`,
    '',
    'Someone asked to reset the password for your On Deck account. To choose a new one, open this link:',
    '',
    link,
    '',
    "It works once and expires in an hour. If you didn't ask for this, ignore this email — your password hasn't changed.",
  ].join('\n')

  // `html` escapes everything interpolated, the name above all: it is
  // whatever the member typed.
  const body = html`<p>Hi ${name},</p>
    <p>Someone asked to reset the password for your On Deck account. To choose a new one, open this link:</p>
    <p><a href="${link}">Choose a new password</a></p>
    <p>
      It works once and expires in an hour. If you didn't ask for this, ignore this email — your password
      hasn't changed.
    </p>`

  return { to, subject: 'Reset your On Deck password', text, html: String(body) }
}
