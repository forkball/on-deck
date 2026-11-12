import { and, eq, gte, or } from 'remix/data-table'

import type { Db } from '../db.ts'
import { sendMail, type SendMail } from '../mail.ts'
import { passwordResetTokens, users, type PasswordResetToken } from '../schema.ts'
import { displayLabel, replaceUserPassword } from '../users.ts'
import { logger } from '../../log.ts'
import { resetEmail } from './email.ts'
import {
  hashResetToken,
  isOverLimit,
  isUsable,
  isWellFormedToken,
  newResetToken,
  RESET_LIMIT_WINDOW_MS,
  RESET_TOKEN_TTL_MS,
} from './tokens.ts'

const log = logger('password-reset')

export interface RequestResetOptions {
  // The absolute link the email carries. Handed in by the controller, which
  // owns the route table; app/data doesn't import it.
  linkFor: (token: string) => string
  send?: SendMail
  now?: number
}

// What happened, for tests and the log. The person who filled in the form is
// never told: every outcome answers them with the same page.
export type RequestResetOutcome = 'sent' | 'unknown' | 'limited'

// `identifier` is what the login form takes — an email or a username — so
// someone who only remembers one of them can still reset.
export async function requestPasswordReset(
  db: Db,
  identifier: string,
  { linkFor, send = sendMail, now = Date.now() }: RequestResetOptions,
): Promise<RequestResetOutcome> {
  const handle = identifier.trim()
  if (!handle) return 'unknown'

  // The same lookup the login form makes — see auth/login/controller.tsx.
  const user = await db.findOne(users, {
    where: or(eq('email', handle.toLowerCase()), eq('display_name', handle)),
  })
  if (!user) return 'unknown'

  const recent = await db.count(passwordResetTokens, {
    where: and(eq('user_id', user.id), gte('created_at', now - RESET_LIMIT_WINDOW_MS)),
  })
  if (isOverLimit(recent)) {
    log.warn(`limit reached for user ${user.id}, not sending another`)
    return 'limited'
  }

  const { token, hash } = newResetToken()
  const row = await db.create(
    passwordResetTokens,
    {
      user_id: user.id,
      token_hash: hash,
      created_at: now,
      expires_at: now + RESET_TOKEN_TTL_MS,
      used_at: null,
    },
    { returnRow: true },
  )

  await send(resetEmail(user.email, displayLabel(user), linkFor(token)), {
    idempotencyKey: `password-reset-${row.id}`,
  })
  log.info(`sent a reset link to user ${user.id}`)
  return 'sent'
}

// The row behind a link, if the link can still be used. Null for every way it
// can't — malformed, unknown, used or expired — since the page says the same
// thing for all of them.
export async function findUsableReset(
  db: Db,
  token: string,
  now = Date.now(),
): Promise<PasswordResetToken | null> {
  if (!isWellFormedToken(token)) return null
  const row = await db.findOne(passwordResetTokens, { where: eq('token_hash', hashResetToken(token)) })
  return row && isUsable(row, now) ? row : null
}

export interface CompletedReset {
  userId: number
  sessionVersion: number
}

// Spends the link and sets the password, or does nothing and answers null if
// the link can no longer be used.
//
// The password is hashed by the caller, after findUsableReset — a hash costs
// 64 MiB and a few hundred ms, and a bogus token shouldn't be able to buy one.
// The check is repeated here, inside the transaction, as the conditional
// update that claims the token: that is what holds when the same link is
// submitted twice at once.
export async function completePasswordReset(
  db: Db,
  token: string,
  passwordHash: string,
  now = Date.now(),
): Promise<CompletedReset | null> {
  if (!isWellFormedToken(token)) return null

  return db.transaction(async (tx) => {
    const claimed = await tx.exec(
      `update password_reset_tokens set used_at = $1
        where token_hash = $2 and used_at is null and expires_at > $1
        returning user_id`,
      [now, hashResetToken(token)],
    )
    const userId = (claimed.rows?.[0] as { user_id: number } | undefined)?.user_id
    if (userId == null) return null

    const sessionVersion = await replaceUserPassword(tx, userId, passwordHash, now)
    return { userId, sessionVersion }
  })
}
