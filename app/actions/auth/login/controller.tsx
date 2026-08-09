import { completeAuth, createCredentialsAuthProvider, verifyCredentials } from 'remix/auth'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { eq, or } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { db } from '../../../data/db.ts'
import { users, type User } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI } from '../../../mediaTypes.ts'
import { verifyPassword } from '../password.ts'
import { LoginPage } from './page.tsx'

const loginSchema = f.object({
  identifier: f.field(s.defaulted(s.string(), '')),
  password: f.field(s.defaulted(s.string(), '')),
})

const passwordProvider = createCredentialsAuthProvider<{ identifier: string; password: string }, User>({
  parse(context) {
    const formData = context.get(FormData)
    return s.parse(loginSchema, formData)
  },
  // `identifier` matches either handle — email and display_name can never
  // collide since both are unique, so at most one row matches.
  async verify({ identifier, password }) {
    const user = await db.findOne(users, { where: or(eq('email', identifier), eq('display_name', identifier)) })
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return null
    }
    return user
  },
})

// Only redirect back to a same-origin relative path — `next`/`return_to`
// come from a query param and form field respectively, both untrusted.
function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

export default createController(routes.auth.login, {
  actions: {
    index(context) {
      const next = safeReturnTo(context.url.searchParams.get('next'))
      return context.render(<LoginPage next={next ?? undefined} />)
    },
    async action(context) {
      const user = await verifyCredentials(passwordProvider, context)

      if (user == null) {
        return context.render(<LoginPage error="Invalid email/username or password." />, { status: 401 })
      }

      const session = completeAuth(context)
      session.set('auth', { userId: user.id })

      const formData = context.get(FormData)
      const returnTo = safeReturnTo(String(formData.get('return_to') || ''))
      return redirect(returnTo || MEDIA_TYPE_UI[DEFAULT_MEDIA_TYPE].hrefs.search(), 303)
    },
  },
})
