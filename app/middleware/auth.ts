import { auth, createSessionAuthScheme } from 'remix/middleware/auth'

import { db } from '../data/db.ts'
import { users, type User } from '../data/schema.ts'

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
