import { completeAuth, createCredentialsAuthProvider, verifyCredentials } from 'remix/auth'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { eq, or } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { db } from '../../../data/db.ts'
import { users, type User } from '../../../data/schema.ts'
import { updateUserPassword } from '../../../data/users.ts'
import { routes } from '../../../routes.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI } from '../../../mediaTypes.ts'
import { hashPassword, needsRehash, verifyPassword } from '../password.ts'
import { LoginPage } from './page.tsx'

const loginSchema = f.object({
  identifier: f.field(s.defaulted(s.string(), '')),
  password: f.field(s.defaulted(s.string(), '')),
})

const passwordProvider = createCredentialsAuthProvider<{ identifier: string; password: string }, User>({
  // An absent field is not a parse failure — both default to empty. One present
  // with a non-string value is: a file part where text is expected. Empty
  // credentials fall through to the same 401 a wrong password gets, which is
  // why this doesn't need a branch of its own.
  parse(context) {
    const formData = context.get(FormData)
    const parsed = s.parseSafe(loginSchema, formData)
    return parsed.success ? parsed.value : { identifier: '', password: '' }
  },
  // `identifier` matches either handle — email and display_name can never
  // collide, since both are unique and usernames may not contain '@' (see
  // data/users.ts), so at most one row matches.
  //
  // Emails are stored lowercased, so the email arm has to lowercase what was
  // typed or an address entered with capitals finds nothing. Usernames are
  // stored as written and matched as written.
  async verify({ identifier, password }) {
    const handle = identifier.trim()
    const user = await db.findOne(users, {
      where: or(eq('email', handle.toLowerCase()), eq('display_name', handle)),
    })
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return null
    }

    // The one moment an existing account's plaintext is in hand, so the only
    // place a stored hash can be moved to the current cost. Nobody is locked
    // out waiting for it: the old hash keeps verifying until this runs.
    //
    // Awaited rather than left in flight — it costs about what the verify above
    // just cost, once per account ever, and a write that quietly failed would
    // leave the account trying again on every future login.
    if (needsRehash(user.password_hash)) {
      const rehashed = await hashPassword(password)
      await updateUserPassword(db, user.id, rehashed)
      return { ...user, password_hash: rehashed }
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
