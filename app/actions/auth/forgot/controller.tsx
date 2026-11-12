import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'

import { appLink } from '../../../data/mail.ts'
import { requestPasswordReset } from '../../../data/passwordResets/requests.ts'
import { logger } from '../../../log.ts'
import { routes } from '../../../routes.ts'
import { ForgotPasswordPage } from './page.tsx'

const log = logger('password-reset')

const forgotSchema = f.object({
  identifier: f.field(s.defaulted(s.string(), '')),
})

// Where the emailed link goes. The token is base64url, so it needs no escaping.
function resetLinkFor(token: string): string {
  return appLink(`${routes.auth.reset.index.href()}?token=${token}`)
}

export default createController(routes.auth.forgot, {
  actions: {
    index(context) {
      return context.render(<ForgotPasswordPage />)
    },

    action(context) {
      const parsed = s.parseSafe(forgotSchema, context.get(FormData))
      const identifier = parsed.success ? parsed.value.identifier : ''

      // Not awaited. Whether an account matched decides whether a row is
      // written and an email sent, and a response that waited for that would
      // take measurably longer for a real account than for a made-up one —
      // the same "is this address registered?" leak the page's wording avoids.
      void requestPasswordReset(context.get(Database), identifier, { linkFor: resetLinkFor }).catch(
        (error) => {
          log.error('could not send a reset link', error)
        },
      )

      return context.render(<ForgotPasswordPage sent />)
    },
  },
})
