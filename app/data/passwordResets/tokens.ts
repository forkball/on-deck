import { createHash, randomBytes } from 'node:crypto'

// The rules for a reset link, free of the database so they are tested directly
// (test/password-resets.test.ts). requests.ts is what applies them to rows.

// Long enough to read the email and pick a password; short enough that a link
// sitting in an inbox for a week is useless to whoever reads that inbox next.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

// Per account, per hour. Enough for "it didn't arrive, send another" a couple
// of times; low enough that the form can't be used to flood someone's inbox.
export const RESETS_PER_HOUR = 3
export const RESET_LIMIT_WINDOW_MS = 60 * 60 * 1000

export interface NewResetToken {
  // Goes in the email and nowhere else.
  token: string
  // Goes in the database.
  hash: string
}

// 32 random bytes: unguessable, so the hash can be a plain SHA-256 rather than
// a slow one. scrypt exists to protect low-entropy secrets people choose; this
// one is chosen by the machine.
export function newResetToken(): NewResetToken {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashResetToken(token) }
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// The shape a token arrives in off a URL or a form. Anything else is answered
// as "expired" without a database lookup — and never reaches the hash.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

export function isUsable(row: { expires_at: number; used_at: number | null }, now: number): boolean {
  return row.used_at == null && row.expires_at > now
}

export function isOverLimit(createdInWindow: number): boolean {
  return createdInWindow >= RESETS_PER_HOUR
}
