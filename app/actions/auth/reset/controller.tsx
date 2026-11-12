import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { completePasswordReset, findUsableReset } from '../../../data/passwordResets/requests.ts'
import { sessionAuthFor } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { hashPassword, PASSWORD_MIN_LENGTH } from '../password.ts'
import { ResetPasswordPage } from './page.tsx'

const resetSchema = f.object({
  token: f.field(s.defaulted(s.string(), '')),
  new_password: f.field(s.defaulted(s.string(), '')),
  confirm_password: f.field(s.defaulted(s.string(), '')),
})

// The token is in this page's URL. Browsers already send only the origin to
// other sites by default; this makes it nothing at all, to every site,
// whatever the browser's default is.
const headers = { 'referrer-policy': 'no-referrer' }

export default createController(routes.auth.reset, {
  actions: {
    async index(context) {
      const token = context.url.searchParams.get('token') ?? ''
      const usable = await findUsableReset(context.get(Database), token)

      return usable
        ? context.render(<ResetPasswordPage token={token} />, { headers })
        : context.render(<ResetPasswordPage token={null} />, { status: 410, headers })
    },

    async action(context) {
      const db = context.get(Database)
      const parsed = s.parseSafe(resetSchema, context.get(FormData))
      const { token, new_password, confirm_password } = parsed.success
        ? parsed.value
        : { token: '', new_password: '', confirm_password: '' }

      // Checked before anything else, and before hashing: a hash costs 64 MiB
      // and a few hundred ms, and a made-up token shouldn't buy one.
      if (!(await findUsableReset(db, token))) {
        return context.render(<ResetPasswordPage token={null} />, { status: 410, headers })
      }

      const reject = (errors: Record<string, string>) =>
        context.render(<ResetPasswordPage token={token} errors={errors} />, { status: 400, headers })

      if (new_password.length < PASSWORD_MIN_LENGTH) {
        return reject({ new_password: `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.` })
      }
      if (new_password !== confirm_password) {
        return reject({ confirm_password: "Those passwords don't match." })
      }

      // Null here means the link was spent between the check above and now —
      // the same link submitted twice at once.
      const completed = await completePasswordReset(db, token, await hashPassword(new_password))
      if (!completed) {
        return context.render(<ResetPasswordPage token={null} />, { status: 410, headers })
      }

      // Opening the link proved the inbox, which is all a login would prove
      // again — so this logs them in rather than sending them to the login form.
      completeAuth(context).set(
        'auth',
        sessionAuthFor({ id: completed.userId, session_version: completed.sessionVersion }),
      )

      return redirect(routes.home.href(), 303)
    },
  },
})
