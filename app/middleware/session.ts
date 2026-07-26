import { createCookie } from 'remix/cookie'
import { createFsSessionStorage } from 'remix/session-storage/fs'

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

export const sessionStorage = createFsSessionStorage('./tmp/sessions')
