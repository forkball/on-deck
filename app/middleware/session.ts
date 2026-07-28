import { createCookie } from 'remix/cookie'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret && process.env.NODE_ENV !== 'test') {
  throw new Error('SESSION_SECRET is required')
}

export const sessionCookie = createCookie('session', {
  secrets: [sessionSecret ?? 'test-only-secret'],
  httpOnly: true,
  sameSite: 'Lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 2592000, // 30 days
  path: '/',
})

// Session data (just { userId }) lives entirely in the signed cookie itself
// — no server-side store to keep in sync, so this works correctly no matter
// how many machines are running. The previous fs-backed storage wrote
// session files to local disk, which only one machine could ever see;
// running more than one caused requests to randomly appear logged out.
export const sessionStorage = createCookieSessionStorage()
