import { completeAuth, createCredentialsAuthProvider, verifyCredentials } from 'remix/auth'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { db } from '../../../data/db.ts'
import { users, type User } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { verifyPassword } from '../../../utils/password.ts'
import { LoginPage } from './page.tsx'

const loginSchema = f.object({
  email: f.field(s.defaulted(s.string(), '')),
  password: f.field(s.defaulted(s.string(), '')),
})

const passwordProvider = createCredentialsAuthProvider<{ email: string; password: string }, User>({
  parse(context) {
    const formData = context.get(FormData)
    return s.parse(loginSchema, formData)
  },
  async verify({ email, password }) {
    const user = await db.findOne(users, { where: { email } })
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return null
    }
    return user
  },
})

export default createController(routes.auth.login, {
  actions: {
    index(context) {
      return context.render(<LoginPage />)
    },
    async action(context) {
      const user = await verifyCredentials(passwordProvider, context)

      if (user == null) {
        return context.render(<LoginPage error="Invalid email or password." />, { status: 401 })
      }

      const session = completeAuth(context)
      session.set('auth', { userId: user.id })

      return redirect(routes.movies.search.href(), 303)
    },
  },
})
