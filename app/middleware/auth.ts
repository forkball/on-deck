import { completeAuth } from 'remix/auth'
import { auth, createSessionAuthScheme, requireAuth as requireAuthBase } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import { db } from '../data/db.ts'
import { users, type User } from '../data/schema.ts'
import { routes } from '../routes.ts'

// What a login cookie holds. `version` is the user's session_version when the
// cookie was issued: changing the password bumps the column, and every cookie
// carrying the old number stops verifying — the only way to log out other
// devices when sessions live entirely in the cookie (see session.ts).
interface SessionAuthValue {
  userId: number
  version: number
}

// Logs `user` in on this request: a fresh session id, and a cookie stamped
// with the current session_version. The only place a login is written — every
// path that logs someone in (login, signup, a reset link, a password change
// re-issuing its own session) comes through here, so none of them can write a
// cookie the next request won't verify.
export function logIn(
  context: Parameters<typeof completeAuth>[0],
  user: Pick<User, 'id' | 'session_version'>,
): void {
  const value: SessionAuthValue = { userId: user.id, version: user.session_version }
  completeAuth(context).set('auth', value)
}

export function loadAuth() {
  return auth({
    schemes: [
      createSessionAuthScheme<User, SessionAuthValue>({
        // Cookies issued before the version existed don't carry one. They read
        // as 0, where every account starts, so its arrival logged nobody out.
        read(session) {
          const value = session.get('auth') as Partial<SessionAuthValue> | null
          return value?.userId == null ? null : { userId: value.userId, version: value.version ?? 0 }
        },
        async verify(value) {
          const user = await db.find(users, value.userId)
          return user && user.session_version === value.version ? user : null
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
