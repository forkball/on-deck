import { logger } from '../log.ts'

// Sending email, through Resend (https://resend.com). One HTTP call, so no SDK.
//
// Three variables, all in .env.example:
//   RESEND_API_KEY  turns sending on. Unset, nothing is sent: in development the
//                   message is written to the log instead, link and all, so the
//                   flow can be followed without an account.
//   MAIL_FROM       the From line. Its domain must be one verified in Resend, or
//                   Resend answers 403.
//   APP_URL         where links in an email point. Fixed configuration rather
//                   than read off the request: a reset is requested by whoever
//                   fills in the form, not necessarily the account's owner, so a
//                   link built from a forged Host header would hand a stranger's
//                   domain the owner's reset token.
//
// With the key set in production, the other two are required at startup — a
// missing one fails the deploy rather than sending broken mail.

const log = logger('mail')

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface SendOptions {
  // Resend drops a repeat of the same key, so a retry after a timeout can't
  // deliver the same email twice.
  idempotencyKey?: string
}

export type SendMail = (message: MailMessage, options?: SendOptions) => Promise<void>

export interface MailConfig {
  apiKey: string | null
  from: string | null
  appUrl: string
}

const DEVELOPMENT_APP_URL = `http://localhost:${process.env.PORT ?? '44100'}`

// Exported for its test; the app reads `mailConfig` below.
export function readMailConfig(env: Record<string, string | undefined>): MailConfig {
  const apiKey = env.RESEND_API_KEY?.trim() || null
  const from = env.MAIL_FROM?.trim() || null
  const rawAppUrl = env.APP_URL?.trim() || null

  if (env.NODE_ENV === 'production' && apiKey) {
    const missing = [!from && 'MAIL_FROM', !rawAppUrl && 'APP_URL'].filter(Boolean)
    if (missing.length > 0) {
      throw new Error(`RESEND_API_KEY is set but ${missing.join(' and ')} is not — see .env.example`)
    }
  }

  let appUrl = DEVELOPMENT_APP_URL
  if (rawAppUrl) {
    const parsed = URL.parse(rawAppUrl)
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new Error(`APP_URL must be an absolute http(s) URL, got ${JSON.stringify(rawAppUrl)}`)
    }
    // An origin only: links are built by appending a path to it.
    appUrl = parsed.origin
  }

  return { apiKey, from, appUrl }
}

export const mailConfig = readMailConfig(process.env)

// An absolute link to a path in this app, for an email.
export function appLink(pathAndQuery: string): string {
  return new URL(pathAndQuery, mailConfig.appUrl).href
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export const sendMail: SendMail = async (message, options = {}) => {
  const { apiKey, from } = mailConfig

  if (!apiKey || !from) {
    // Never the body in production: it holds a live reset link, and the log is
    // read on the Fly dashboard.
    if (process.env.NODE_ENV === 'production') {
      log.error(`not sent, mail is not configured: "${message.subject}"`)
    } else if (process.env.NODE_ENV !== 'test') {
      log.info(`not sent (no RESEND_API_KEY) — to ${message.to}: "${message.subject}"\n${message.text}`)
    }
    return
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    // Resend's error body names the problem ("domain is not verified"), and
    // holds nothing secret.
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend answered ${response.status}: ${detail.slice(0, 300)}`)
  }
}
