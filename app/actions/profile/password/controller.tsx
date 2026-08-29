import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import type { User } from '../../../data/schema.ts'
import { displayLabel, updateUserPassword } from '../../../data/users.ts'
import { requireAuth } from '../../../middleware/auth.ts'
import { routes } from '../../../routes.ts'
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '../../auth/password.ts'
import { ProfilePasswordPage } from './page.tsx'

// No shape rules on any of them — what each has to be depends on the others,
// and the action checks them in the order that gives the most useful answer.
const passwordSchema = f.object({
  current_password: f.field(s.defaulted(s.string(), '')),
  new_password: f.field(s.defaulted(s.string(), '')),
  confirm_password: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.profile.password, {
  middleware: [requireAuth<User>()],
  actions: {
    index(context) {
      const auth = context.get(Auth)

      return context.render(<ProfilePasswordPage displayName={displayLabel(auth.identity)} />)
    },

    async update(context) {
      const auth = context.get(Auth)

      // Nothing is echoed back: every field here is a password.
      const reject = (errors: Record<string, string>, status: number, confirming = false) =>
        context.render(
          <ProfilePasswordPage
            errors={errors}
            confirming={confirming}
            displayName={displayLabel(auth.identity)}
          />,
          { status },
        )

      const parsed = s.parseSafe(passwordSchema, context.get(FormData))
      if (!parsed.success) return reject({ new_password: 'Fill in both password boxes.' }, 400)

      const { current_password, new_password, confirm_password } = parsed.value

      // The new password is judged first, so a form that was never going to
      // be accepted doesn't ask for a password before saying so.
      if (new_password.length < PASSWORD_MIN_LENGTH) {
        return reject({ new_password: `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.` }, 400)
      }
      if (new_password !== confirm_password) {
        return reject({ confirm_password: "Those passwords don't match." }, 400)
      }

      if (!(await verifyPassword(current_password, auth.identity.password_hash))) {
        // Reopened rather than merely flagged: with JS off the modal is the
        // only place that box exists, so a closed one would hide the error
        // behind a trigger nobody was told to look for.
        return reject(
          { current_password: current_password ? "That isn't your current password." : '' },
          403,
          true,
        )
      }

      await updateUserPassword(context.get(Database), auth.identity.id, await hashPassword(new_password))

      return redirect(`${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
