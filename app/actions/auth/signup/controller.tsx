import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import { email, minLength } from 'remix/data-schema/checks'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { users } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/document.tsx'
import { Nav } from '../../../ui/nav.tsx'
import { hashPassword } from '../../../utils/password.ts'

const signupSchema = f.object({
  email: f.field(s.string().pipe(email())),
  password: f.field(s.string().pipe(minLength(8))),
  display_name: f.field(s.defaulted(s.string(), '')),
})

interface SignupPageProps {
  error?: string
  values?: Record<string, string>
}

function SignupPage(handle: Handle<SignupPageProps>) {
  return () => {
    const { error, values } = handle.props

    return (
      <Document title="Sign up | On Deck">
        <Nav authed={false} />
        <main mix={css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Sign up</h1>
          {error && <p mix={css({ color: '#b91c1c' })}>{error}</p>}
          <form
            method="post"
            action={routes.auth.signup.action.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
          >
            <label>
              Email
              <input type="email" name="email" required defaultValue={values?.email ?? ''} />
            </label>
            <label>
              Password (min 8 characters)
              <input type="password" name="password" required minLength={8} />
            </label>
            <label>
              Display name (optional)
              <input type="text" name="display_name" defaultValue={values?.display_name ?? ''} />
            </label>
            <button type="submit">Create account</button>
          </form>
          <p>
            Already have an account? <a href={routes.auth.login.index.href()}>Log in</a>
          </p>
        </main>
      </Document>
    )
  }
}

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

      return redirect(routes.movies.search.href(), 303)
    },
  },
})
