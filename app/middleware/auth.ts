import { auth, createSessionAuthScheme, requireAuth as requireAuthBase } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'

import { db } from '../data/db.ts'
import { users, type User } from '../data/schema.ts'
import { routes } from '../routes.ts'

// What a login cookie holds. `version` is the user's session_version when the
// cookie was issued: changing the password bumps the column, and every cookie
// carrying the old number stops verifying — the only way to log out other
// devices when sessions live entirely in the cookie (see session.ts).
//
// Optional because cookies issued before it existed don't carry it. They read
// as 0, which is where every account starts, so the column's arrival logged
// nobody out.
interface SessionAuthValue {
  userId: number
  version?: number
}

// The one way a login is written to the session, so no path can forget the
// version and be logged out by the next request.
export function sessionAuthFor(user: Pick<User, 'id' | 'session_version'>): SessionAuthValue {
  return { userId: user.id, version: user.session_version }
}

export function loadAuth() {
  return auth({
    schemes: [
      createSessionAuthScheme<User, SessionAuthValue>({
        read(session) {
          return (session.get('auth') as SessionAuthValue | null) ?? null
        },
        async verify(value) {
          const user = await db.find(users, value.userId)
          if (!user || (value.version ?? 0) !== user.session_version) return null
          return user
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
