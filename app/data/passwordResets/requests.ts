import { and, eq, gte } from 'remix/data-table'

import type { Db } from '../db.ts'
import { sendMail, type SendMail } from '../mail.ts'
import { passwordResetTokens, type User } from '../schema.ts'
import { displayLabel, findUserByIdentifier, replaceUserPassword } from '../users.ts'
import { logger } from '../../log.ts'
import { resetEmail } from './email.ts'
import {
  hashResetToken,
  isUsable,
  isWellFormedToken,
  newResetToken,
  RESET_LIMIT_WINDOW_MS,
  RESET_TOKEN_TTL_MS,
  RESETS_PER_HOUR,
  RESETS_PER_IP_PER_HOUR,
} from './tokens.ts'

const log = logger('password-reset')

export interface RequestResetOptions {
  // The absolute link the email carries. Handed in by the controller, which
  // owns the route table; app/data doesn't import it.
  linkFor: (token: string) => string
  // Who asked, for the per-IP cap. Null when it isn't known (see clientIp in
  // the forgot controller); only the per-account cap applies then.
  ip?: string | null
  send?: SendMail
  now?: number
}

// What happened, for tests and the log. The person who filled in the form is
// never told: every outcome answers them with the same page.
export type RequestResetOutcome = 'sent' | 'unknown' | 'limited'

// What the forgot form calls: starts the request and returns at once, without
// waiting to learn whether an account matched. Whether one did decides
// whether a row is written and an email sent, and a response that waited for
// that would take measurably longer for a real account than a made-up one —
// the same "is this address registered?" leak the page's wording avoids.
// Returning nothing is what keeps a caller from awaiting it by accident.
export function queuePasswordReset(db: Db, identifier: string, options: RequestResetOptions): void {
  requestPasswordReset(db, identifier, options).catch((error) => {
    log.error('could not send a reset link', error)
  })
}

// `identifier` is what the login form takes — an email or a username — so
// someone who only remembers one of them can still reset. Exported for tests;
// the app goes through queuePasswordReset.
export async function requestPasswordReset(
  db: Db,
  identifier: string,
  { linkFor, ip = null, send = sendMail, now = Date.now() }: RequestResetOptions,
): Promise<RequestResetOutcome> {
  // Links sent in the last window, by the given column. Only links actually
  // sent are rows, so asking about accounts that don't exist counts toward
  // neither cap — those send nothing, which is what the caps protect.
  const sentRecently = (column: 'requested_ip' | 'user_id', value: string | number) =>
    db.count(passwordResetTokens, {
      where: and(eq(column, value), gte('created_at', now - RESET_LIMIT_WINDOW_MS)),
    })

  // Before the account lookup, so an address over its cap costs no more than
  // a count.
  if (ip && (await sentRecently('requested_ip', ip)) >= RESETS_PER_IP_PER_HOUR) {
    log.warn(`limit reached for ${ip}, not sending another`)
    return 'limited'
  }

  const user = await findUserByIdentifier(db, identifier)
  if (!user) return 'unknown'

  if ((await sentRecently('user_id', user.id)) >= RESETS_PER_HOUR) {
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
      requested_ip: ip,
    },
    { returnRow: true },
  )

  await send(resetEmail(user.email, displayLabel(user), linkFor(token)), {
    idempotencyKey: `password-reset-${row.id}`,
  })
  log.info(`sent a reset link to user ${user.id}`)
  return 'sent'
}

// Whether a link can still be used. False for every way it can't — malformed,
// unknown, used or expired — since the page says the same thing for all of
// them. A malformed token is turned away here, before it is hashed.
export async function isResetUsable(db: Db, token: string, now = Date.now()): Promise<boolean> {
  if (!isWellFormedToken(token)) return false
  const row = await db.findOne(passwordResetTokens, { where: eq('token_hash', hashResetToken(token)) })
  return row != null && isUsable(row, now)
}

// Spends the link and sets the password, answering what logIn needs — or does
// nothing and answers null if the link can no longer be used.
//
// The password is hashed by the caller, after isResetUsable — a hash costs
// 64 MiB and a few hundred ms, and a bogus token shouldn't be able to buy one.
// The check is repeated here, inside the transaction, as the conditional
// update that claims the token: that is what holds when the same link is
// submitted twice at once.
export async function completePasswordReset(
  db: Db,
  token: string,
  passwordHash: string,
  now = Date.now(),
): Promise<Pick<User, 'id' | 'session_version'> | null> {
  return db.transaction(async (tx) => {
    const claimed = await tx.exec(
      `update password_reset_tokens set used_at = $1
        where token_hash = $2 and used_at is null and expires_at > $1
        returning user_id`,
      [now, hashResetToken(token)],
    )
    const userId = (claimed.rows?.[0] as { user_id: number } | undefined)?.user_id
    if (userId == null) return null

    return replaceUserPassword(tx, userId, passwordHash, now)
  })
}
