import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import { minLength } from 'remix/data-schema/checks'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { users } from '../../../data/schema.ts'
import {
  emailSchema,
  findUserByEmail,
  findUserByUsername,
  USER_FIELD_MESSAGES,
  userFieldErrors,
  usernameSchema,
} from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI } from '../../../mediaTypes.ts'
import { hashPassword, PASSWORD_MIN_LENGTH } from '../password.ts'
import { SignupPage } from './page.tsx'

const signupSchema = f.object({
  // Email and username are validated by the same rules the edit-profile form
  // uses — see data/users.ts.
  email: f.field(emailSchema),
  password: f.field(s.string().pipe(minLength(PASSWORD_MIN_LENGTH))),
  display_name: f.field(usernameSchema),
})

const SIGNUP_MESSAGES = {
  ...USER_FIELD_MESSAGES,
  password: `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`,
}

export default createController(routes.auth.signup, {
  actions: {
    index(context) {
      return context.render(<SignupPage />)
    },
    async action(context) {
      const formData = context.get(FormData)
      const parsed = s.parseSafe(signupSchema, formData)

      const values = Object.fromEntries(formData) as Record<string, string>

      if (!parsed.success) {
        return context.render(
          <SignupPage errors={userFieldErrors(parsed.issues, SIGNUP_MESSAGES)} values={values} />,
          { status: 400 },
        )
      }

      const db = context.get(Database)

      // Both columns are unique, so this is checked twice over: here, to say
      // which field collided, and by the index, which is what actually holds
      // under a race.
      const errors: Record<string, string> = {}
      if (await findUserByEmail(db, parsed.value.email)) {
        errors.email = 'An account with that email already exists.'
      }
      if (await findUserByUsername(db, parsed.value.display_name)) {
        errors.display_name = 'That username is already taken.'
      }

      if (Object.keys(errors).length > 0) {
        return context.render(<SignupPage errors={errors} values={values} />, { status: 409 })
      }

      const passwordHash = await hashPassword(parsed.value.password)
      const user = await db.create(
        users,
        {
          email: parsed.value.email,
          password_hash: passwordHash,
          display_name: parsed.value.display_name,
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
