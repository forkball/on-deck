import { completeAuth, createCredentialsAuthProvider, verifyCredentials } from 'remix/auth'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { db } from '../../../data/db.ts'
import { users, type User } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/document.tsx'
import { Nav } from '../../../ui/nav.tsx'
import { verifyPassword } from '../../../utils/password.ts'

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

function LoginPage(handle: Handle<{ error?: string }>) {
  return () => {
    const { error } = handle.props

    return (
      <Document title="Log in | On Deck">
        <Nav authed={false} />
        <main mix={css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Log in</h1>
          {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
          <form
            method="post"
            action={routes.auth.login.action.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
          >
            <label>
              Email
              <input type="email" name="email" required />
            </label>
            <label>
              Password
              <input type="password" name="password" required />
            </label>
            <button type="submit">Log in</button>
          </form>
          <p>
            Need an account? <a href={routes.auth.signup.index.href()}>Sign up</a>
          </p>
        </main>
      </Document>
    )
  }
}

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
