import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'

import { appLink } from '../../../data/mail.ts'
import { queuePasswordReset } from '../../../data/passwordResets/requests.ts'
import { routes } from '../../../routes.ts'
import { clientIp } from './client-ip.ts'
import { ForgotPasswordPage } from './page.tsx'

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

      // Returns before learning whether an account matched — see
      // queuePasswordReset for why that matters here.
      queuePasswordReset(context.get(Database), identifier, {
        linkFor: resetLinkFor,
        ip: clientIp(context.request.headers),
      })

      return context.render(<ForgotPasswordPage sent />)
    },
  },
})
