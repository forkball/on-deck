import * as s from 'remix/data-schema'
import type { Issue } from 'remix/data-schema'
import { email, maxLength, minLength } from 'remix/data-schema/checks'
import { and, eq, ilike, ne, or } from 'remix/data-table'

import type { Db } from './db.ts'
import { users, type User } from './schema.ts'

export function displayLabel(user: Pick<User, 'display_name' | 'email'>): string {
  return user.display_name || user.email
}

// Username only, never email: matching on address lets a stranger confirm that
// a given one is registered, which is worth more to them than the search is.
export async function searchUsers(db: Db, query: string, excludeUserId: number): Promise<User[]> {
  const pattern = `%${query}%`
  return db.findMany(users, {
    where: and(ilike('display_name', pattern), ne('id', excludeUserId)),
    limit: 20,
  })
}

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 16
export const BIO_MAX_LENGTH = 500

// Usernames double as a login handle alongside email, putting both in one
// namespace: a username shaped like someone's email address would make that
// lookup match two rows. Barring '@' keeps them apart.
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/

export const USERNAME_HINT = `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters — letters, numbers, and . _ - only.`

// Lowercased on the way in so the unique index is the case-insensitive check
// everyone assumes it is, and so logging in works whatever case was typed.
// 254 is the longest an address can be and still be deliverable.
export const emailSchema = s
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(email(), maxLength(254))

export const usernameSchema = s
  .string()
  .transform((value) => value.trim())
  .pipe(minLength(USERNAME_MIN_LENGTH), maxLength(USERNAME_MAX_LENGTH))
  .refine((value) => USERNAME_PATTERN.test(value))

export const bioSchema = s
  .defaulted(s.string(), '')
  .transform((value) => value.trim())
  .pipe(maxLength(BIO_MAX_LENGTH))

export const USER_FIELD_MESSAGES: Record<string, string> = {
  email: 'Enter a valid email address.',
  display_name: `Usernames are ${USERNAME_HINT}`,
  bio: `Bios are limited to ${BIO_MAX_LENGTH} characters.`,
}

function issueField(issue: Issue): string {
  const segment = issue.path?.[0]
  if (segment == null) return ''
  return typeof segment === 'object' ? String(segment.key) : String(segment)
}

export function userFieldErrors(
  issues: readonly Issue[],
  messages: Record<string, string> = USER_FIELD_MESSAGES,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const field = issueField(issue)
    if (messages[field]) errors[field] = messages[field]
  }
  return errors
}

// `excludeUserId` is what makes these usable while editing: saving the form
// without touching your email must not report your own row as a conflict.
export async function findUserByEmail(db: Db, value: string, excludeUserId?: number): Promise<User | null> {
  const match = eq('email', value)
  return db.findOne(users, {
    where: excludeUserId === undefined ? match : and(match, ne('id', excludeUserId)),
  })
}

export async function findUserByUsername(
  db: Db,
  value: string,
  excludeUserId?: number,
): Promise<User | null> {
  const match = eq('display_name', value)
  return db.findOne(users, {
    where: excludeUserId === undefined ? match : and(match, ne('id', excludeUserId)),
  })
}

export interface UserProfileFields {
  email: string
  display_name: string
  bio: string
  is_private: boolean
}

export async function updateUserProfile(db: Db, userId: number, fields: UserProfileFields): Promise<void> {
  // `undefined` writes NULL here rather than skipping the field, which is
  // what clearing a bio has to do.
  await db.update(users, userId, { ...fields, bio: fields.bio || undefined })
}

export async function updateProfileSettings(
  db: Db,
  userId: number,
  settings: { logLimit: number | null; useNotes: boolean },
): Promise<void> {
  await db.update(users, userId, {
    // `undefined` is what writes NULL, and null is this column's "all of it".
    profile_log_limit: settings.logLimit ?? undefined,
    profile_use_notes: settings.useNotes,
  })
}

export async function updateWatchRegion(db: Db, userId: number, region: string): Promise<void> {
  await db.update(users, userId, { watch_region: region })
}

// Already serialized (serializeMediaOrder): null is "the default order", and
// `undefined` is what writes NULL.
export async function updateMediaOrder(db: Db, userId: number, order: string | null): Promise<void> {
  await db.update(users, userId, { media_order: order ?? undefined })
}

// What the login form and the forgot-password form both take: an email or a
// username. They can never both match — both columns are unique and usernames
// may not contain '@' (USERNAME_PATTERN) — so at most one row comes back.
//
// Emails are stored lowercased, so the email arm lowercases what was typed;
// usernames are stored as written and matched as written.
export async function findUserByIdentifier(db: Db, identifier: string): Promise<User | null> {
  const handle = identifier.trim()
  if (!handle) return null
  return db.findOne(users, { where: or(eq('email', handle.toLowerCase()), eq('display_name', handle)) })
}

// Rewrites the hash of the *same* password at the current cost — the login
// rehash. Nothing about who may be logged in changes, so sessions are left
// alone. A new password goes through replaceUserPassword instead.
export async function rehashUserPassword(db: Db, userId: number, passwordHash: string): Promise<void> {
  await db.update(users, userId, { password_hash: passwordHash })
}

// Sets a new password and ends every session issued under the old one, then
// answers what logIn needs to keep the person who just changed it logged in.
// Also spends any reset link still outstanding: a link emailed before the
// change shouldn't be able to undo it.
//
// Both paths that change a password come through here — the profile form and
// a reset link — so one of them can't forget either half. One statement, so
// the two halves can't come apart either.
export async function replaceUserPassword(
  db: Db,
  userId: number,
  passwordHash: string,
  now = Date.now(),
): Promise<Pick<User, 'id' | 'session_version'>> {
  const result = await db.exec(
    `with spent as (
       update password_reset_tokens set used_at = $3 where user_id = $2 and used_at is null
     )
     update users set password_hash = $1, session_version = session_version + 1
      where id = $2
      returning id, session_version`,
    [passwordHash, userId, now],
  )
  return result.rows?.[0] as Pick<User, 'id' | 'session_version'>
}
