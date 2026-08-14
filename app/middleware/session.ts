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

// Session data (just { userId }) lives entirely in the signed cookie — no
// server-side store to keep in sync, which is what makes this correct on more
// than one machine. Anything disk-backed is visible to only one of them.
export const sessionStorage = createCookieSessionStorage()
