import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import { email, minLength } from 'remix/data-schema/checks'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { users } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI } from '../../../mediaTypes.ts'
import { hashPassword } from '../password.ts'
import { SignupPage } from './page.tsx'

const signupSchema = f.object({
  email: f.field(s.string().pipe(email())),
  password: f.field(s.string().pipe(minLength(8))),
  display_name: f.field(s.defaulted(s.string(), '')),
})

export default createController(routes.auth.signup, {
  actions: {
    index(context) {
      return context.render(<SignupPage />)
    },
    async action(context) {
      const formData = context.get(FormData)
      const parsed = s.parseSafe(signupSchema, formData)

      if (!parsed.success) {
        return context.render(
          <SignupPage
            error="Please enter a valid email and a password of at least 8 characters."
            values={Object.fromEntries(formData) as Record<string, string>}
          />,
          { status: 400 },
        )
      }

      const db = context.get(Database)
      const existing = await db.findOne(users, { where: { email: parsed.value.email } })
      if (existing) {
        return context.render(
          <SignupPage
            error="An account with that email already exists."
            values={Object.fromEntries(formData) as Record<string, string>}
          />,
          { status: 409 },
        )
      }

      const passwordHash = await hashPassword(parsed.value.password)
      const user = await db.create(
        users,
        {
          email: parsed.value.email,
          password_hash: passwordHash,
          display_name: parsed.value.display_name || undefined,
          created_at: Date.now(),
        },
        { returnRow: true },
      )

      const session = completeAuth(context)
      session.set('auth', { userId: user.id })

      return redirect(MEDIA_TYPE_UI[DEFAULT_MEDIA_TYPE].hrefs.search(), 303)
    },
  },
})
