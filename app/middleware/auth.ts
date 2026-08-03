import { auth, createSessionAuthScheme, requireAuth as requireAuthBase } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import { db } from '../data/db.ts'
import { users, type User } from '../data/schema.ts'
import { routes } from '../routes.ts'

interface SessionAuthValue {
  userId: number
}

export function loadAuth() {
  return auth({
    schemes: [
      createSessionAuthScheme<User, SessionAuthValue>({
        read(session) {
          return (session.get('auth') as SessionAuthValue | null) ?? null
        },
        async verify(value) {
          return (await db.find(users, value.userId)) ?? null
        },
        invalidate(session) {
          session.unset('auth')
        },
      }),
    ],
  })
}

// Redirects to login with `next` set, rather than a bare 401. Use this instead
// of importing requireAuth from remix/middleware/auth directly.
export function requireAuth<identity = unknown>() {
  return requireAuthBase<identity>({
    onFailure(context) {
      const next = context.url.pathname + context.url.search
      return redirect(`${routes.auth.login.index.href()}?next=${encodeURIComponent(next)}`, 303)
    },
  })
}
