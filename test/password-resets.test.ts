import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { clientIp } from '../app/actions/auth/forgot/client-ip.ts'
import { hashPassword, verifyPassword } from '../app/actions/auth/password.ts'
import { pool, db } from '../app/data/db.ts'
import { readMailConfig, type MailMessage, type SendMail } from '../app/data/mail.ts'
import { resetEmail } from '../app/data/passwordResets/email.ts'
import {
  completePasswordReset,
  isResetUsable,
  requestPasswordReset,
} from '../app/data/passwordResets/requests.ts'
import {
  hashResetToken,
  isUsable,
  isWellFormedToken,
  newResetToken,
  RESET_TOKEN_TTL_MS,
  RESETS_PER_HOUR,
  RESETS_PER_IP_PER_HOUR,
} from '../app/data/passwordResets/tokens.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'
import { get, post, sessionCookieFrom } from './support/router.ts'

// "Forgot your password?": the rules in passwordResets/tokens.ts and the email
// and mail config, which need no database, then the requests against one, then
// the whole flow through the router.

describe('reset token rules', () => {
  it('makes a token the URL can carry, and stores only its hash', () => {
    const { token, hash } = newResetToken()
    assert.ok(isWellFormedToken(token), token)
    assert.equal(hash, hashResetToken(token))
    assert.notEqual(hash, token)
    assert.notEqual(newResetToken().token, token)
  })

  it('refuses anything not shaped like a token before it is looked up', () => {
    for (const value of ['', 'abc', `${'a'.repeat(42)}!`, 'a'.repeat(44), "' or 1=1 --"]) {
      assert.equal(isWellFormedToken(value), false, value)
    }
  })

  it('is usable until it expires or is used', () => {
    const now = 1_000_000
    assert.equal(isUsable({ expires_at: now + 1, used_at: null }, now), true)
    assert.equal(isUsable({ expires_at: now, used_at: null }, now), false)
    assert.equal(isUsable({ expires_at: now + 1, used_at: now - 1 }, now), false)
  })

  it('lets one address reset more than one account an hour', () => {
    assert.ok(RESETS_PER_IP_PER_HOUR > RESETS_PER_HOUR)
  })
})

describe('client ip', () => {
  const headers = (init: Record<string, string>) => new Headers(init)

  it("reads Fly's header, IPv4 or IPv6", () => {
    assert.equal(clientIp(headers({ 'fly-client-ip': '203.0.113.7' })), '203.0.113.7')
    assert.equal(clientIp(headers({ 'fly-client-ip': ' 2001:db8::1 ' })), '2001:db8::1')
  })

  // X-Forwarded-For is whatever the client started it with; only Fly's own
  // header is overwritten by the proxy.
  it('ignores X-Forwarded-For, and anything that is not an address', () => {
    assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.7' })), null)
    assert.equal(clientIp(headers({ 'fly-client-ip': 'not-an-ip' })), null)
    assert.equal(clientIp(headers({ 'fly-client-ip': '203.0.113.7, 10.0.0.1' })), null)
    assert.equal(clientIp(headers({})), null)
  })
})

describe('reset email', () => {
  it('carries the link, and escapes the name in the HTML', () => {
    const email = resetEmail('a@example.test', '<b>Ann</b>', 'https://example.test/auth/reset?token=abc')
    assert.equal(email.to, 'a@example.test')
    assert.match(email.text, /https:\/\/example\.test\/auth\/reset\?token=abc/)
    assert.match(email.html, /href="https:\/\/example\.test\/auth\/reset\?token=abc"/)
    assert.doesNotMatch(email.html, /<b>Ann<\/b>/)
    assert.match(email.html, /&lt;b&gt;Ann/)
  })
})

describe('mail config', () => {
  const full = {
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'On Deck <noreply@example.test>',
    APP_URL: 'https://example.test',
  }

  it('reads a complete production config', () => {
    assert.deepEqual(readMailConfig(full), {
      apiKey: 're_test',
      from: 'On Deck <noreply@example.test>',
      appUrl: 'https://example.test',
    })
  })

  it('refuses to start in production with the key but nowhere to link or send from', () => {
    assert.throws(() => readMailConfig({ ...full, APP_URL: '' }), /APP_URL/)
    assert.throws(() => readMailConfig({ ...full, MAIL_FROM: undefined }), /MAIL_FROM/)
  })

  // Shipping the code before the secrets are set must not take the site down.
  it('starts in production with no key at all', () => {
    assert.equal(readMailConfig({ NODE_ENV: 'production' }).apiKey, null)
  })

  it('keeps only the origin of APP_URL, and refuses one that is not a URL', () => {
    assert.equal(
      readMailConfig({ ...full, APP_URL: 'https://example.test/some/path/' }).appUrl,
      'https://example.test',
    )
    assert.throws(() => readMailConfig({ ...full, APP_URL: 'example.test' }), /absolute/)
  })

  it('falls back to localhost in development', () => {
    assert.match(readMailConfig({ NODE_ENV: 'development' }).appUrl, /^http:\/\/localhost:\d+$/)
  })
})

// Captures what would have been emailed, and pulls the token back out of it.
function capturingSender(): { send: SendMail; sent: MailMessage[]; lastToken: () => string } {
  const sent: MailMessage[] = []
  return {
    sent,
    send: async (message) => {
      sent.push(message)
    },
    lastToken: () => {
      const match = sent.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/)
      assert.ok(match, 'no token in the last email')
      return match[1]!
    },
  }
}

const linkFor = (token: string) => `https://example.test/auth/reset?token=${token}`

describe('password reset requests', { skip: skipWithoutDatabase }, () => {
  const userIds: number[] = []
  after(() => deleteUsers(userIds))

  it('emails a usable link to an account found by email or by username', async () => {
    const user = await insertUser('reset-request')
    userIds.push(user.id)
    const mail = capturingSender()

    assert.equal(
      await requestPasswordReset(db, user.email.toUpperCase(), { linkFor, send: mail.send }),
      'sent',
    )
    assert.equal(mail.sent[0]!.to, user.email)
    assert.equal(await isResetUsable(db, mail.lastToken()), true)

    assert.equal(
      await requestPasswordReset(db, ` ${user.displayName} `, { linkFor, send: mail.send }),
      'sent',
    )
    assert.equal(mail.sent.length, 2)
  })

  it('sends nothing for an account that does not exist', async () => {
    const mail = capturingSender()
    assert.equal(
      await requestPasswordReset(db, 'nobody@example.test', { linkFor, send: mail.send }),
      'unknown',
    )
    assert.equal(await requestPasswordReset(db, '   ', { linkFor, send: mail.send }), 'unknown')
    assert.equal(mail.sent.length, 0)
  })

  it(`stops after ${RESETS_PER_HOUR} in an hour, and allows more once it has passed`, async () => {
    const user = await insertUser('reset-limit')
    userIds.push(user.id)
    const mail = capturingSender()
    const now = Date.now()

    for (let i = 0; i < RESETS_PER_HOUR; i++) {
      assert.equal(await requestPasswordReset(db, user.email, { linkFor, send: mail.send, now }), 'sent')
    }
    assert.equal(await requestPasswordReset(db, user.email, { linkFor, send: mail.send, now }), 'limited')
    assert.equal(mail.sent.length, RESETS_PER_HOUR)

    const later = now + 61 * 60 * 1000
    assert.equal(await requestPasswordReset(db, user.email, { linkFor, send: mail.send, now: later }), 'sent')
  })

  it(`stops one address after ${RESETS_PER_IP_PER_HOUR} links an hour, across accounts`, async () => {
    // Random, so a run can't be limited by rows an earlier one left behind.
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`
    const mail = capturingSender()
    const now = Date.now()

    const accounts = []
    for (let i = 0; i <= RESETS_PER_IP_PER_HOUR; i++) {
      const user = await insertUser('reset-ip')
      userIds.push(user.id)
      accounts.push(user)
    }

    for (const user of accounts.slice(0, RESETS_PER_IP_PER_HOUR)) {
      assert.equal(await requestPasswordReset(db, user.email, { linkFor, ip, send: mail.send, now }), 'sent')
    }
    const last = accounts.at(-1)!.email
    assert.equal(await requestPasswordReset(db, last, { linkFor, ip, send: mail.send, now }), 'limited')
    assert.equal(mail.sent.length, RESETS_PER_IP_PER_HOUR)

    // Another address, an unknown one, or the same one an hour on, still gets through.
    assert.equal(
      await requestPasswordReset(db, last, { linkFor, ip: '192.0.2.1', send: mail.send, now }),
      'sent',
    )
    const second = accounts.at(-2)!.email
    assert.equal(await requestPasswordReset(db, second, { linkFor, ip: null, send: mail.send, now }), 'sent')
    const later = now + 61 * 60 * 1000
    const third = accounts.at(-3)!.email
    assert.equal(await requestPasswordReset(db, third, { linkFor, ip, send: mail.send, now: later }), 'sent')
  })

  it('does not count asking about accounts that do not exist', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`
    const mail = capturingSender()
    for (let i = 0; i <= RESETS_PER_IP_PER_HOUR; i++) {
      await requestPasswordReset(db, `nobody-${i}@example.test`, { linkFor, ip, send: mail.send })
    }
    const user = await insertUser('reset-ip-unknown')
    userIds.push(user.id)
    assert.equal(await requestPasswordReset(db, user.email, { linkFor, ip, send: mail.send }), 'sent')
  })

  it('does not accept a link once it has expired', async () => {
    const user = await insertUser('reset-expiry')
    userIds.push(user.id)
    const mail = capturingSender()
    const now = Date.now()
    await requestPasswordReset(db, user.email, { linkFor, send: mail.send, now })
    const token = mail.lastToken()

    assert.equal(await isResetUsable(db, token, now + RESET_TOKEN_TTL_MS - 1), true)
    assert.equal(await isResetUsable(db, token, now + RESET_TOKEN_TTL_MS), false)
    assert.equal(await completePasswordReset(db, token, 'unused', now + RESET_TOKEN_TTL_MS), null)
  })

  it('sets the password once, ends old sessions, and spends every other outstanding link', async () => {
    const user = await insertUser('reset-complete', await hashPassword('old-password'))
    userIds.push(user.id)
    const mail = capturingSender()
    await requestPasswordReset(db, user.email, { linkFor, send: mail.send })
    const first = mail.lastToken()
    await requestPasswordReset(db, user.email, { linkFor, send: mail.send })
    const second = mail.lastToken()

    const completed = await completePasswordReset(db, second, await hashPassword('new-password'))
    assert.deepEqual(completed, { id: user.id, session_version: 1 })

    const { rows } = await pool.query('select password_hash from users where id = $1', [user.id])
    assert.ok(await verifyPassword('new-password', rows[0].password_hash))
    assert.equal(await verifyPassword('old-password', rows[0].password_hash), false)

    assert.equal(await completePasswordReset(db, second, 'again'), null)
    assert.equal(await isResetUsable(db, first), false)
  })

  it('lets only one of two simultaneous uses of a link through', async () => {
    const user = await insertUser('reset-race')
    userIds.push(user.id)
    const mail = capturingSender()
    await requestPasswordReset(db, user.email, { linkFor, send: mail.send })
    const token = mail.lastToken()

    const results = await Promise.all([
      completePasswordReset(db, token, 'hash-a'),
      completePasswordReset(db, token, 'hash-b'),
    ])
    assert.equal(results.filter(Boolean).length, 1)
  })
})

// Through the real router: the pages, what the forgot form tells a stranger,
// and that a reset logs out every session issued before it.
describe('password reset routes', { skip: skipWithoutDatabase }, () => {
  const OLD = 'old-password-1'
  const NEW = 'new-password-2'
  const userIds: number[] = []
  let email: string

  before(async () => {
    const user = await insertUser('reset-route', await hashPassword(OLD))
    userIds.push(user.id)
    email = user.email
  })

  after(async () => {
    await deleteUsers(userIds)
    await pool.end()
  })

  async function login(password: string): Promise<string | null> {
    const response = await post('/auth/login', { identifier: email, password })
    return response.status === 303 ? sessionCookieFrom(response) : null
  }

  it('links to the forgot form from the login page', async () => {
    assert.match((await get('/auth/login')).body, /href="\/auth\/forgot"/)
    const form = await get('/auth/forgot')
    assert.equal(form.status, 200)
    assert.match(form.body, /name="identifier"/)
  })

  it('answers the forgot form the same whether or not the account exists', async () => {
    const known = await post('/auth/forgot', { identifier: email })
    const unknown = await post('/auth/forgot', { identifier: 'nobody-at-all@example.test' })
    assert.equal(known.status, 200)
    assert.equal(unknown.status, 200)
    assert.equal(known.body, unknown.body)

    // The send runs after the response; wait for its row so it isn't still
    // writing when the pool closes.
    for (let i = 0; i < 50; i++) {
      const { rows } = await pool.query('select 1 from password_reset_tokens where user_id = $1', [
        userIds[0],
      ])
      if (rows.length > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail('the forgot form wrote no reset row for a real account')
  })

  it('says a bad or missing link has expired, without a form', async () => {
    for (const path of ['/auth/reset', '/auth/reset?token=nonsense', `/auth/reset?token=${'a'.repeat(43)}`]) {
      const response = await get(path)
      assert.equal(response.status, 410, path)
      assert.doesNotMatch(response.body, /name="new_password"/)
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    }
    const posted = await post('/auth/reset', { token: 'nonsense', new_password: NEW, confirm_password: NEW })
    assert.equal(posted.status, 410)
  })

  it('resets the password, logs in, and logs out every earlier session', async () => {
    const oldCookie = await login(OLD)
    assert.ok(oldCookie)
    assert.equal((await get('/profile', oldCookie)).status, 200)

    const mail = capturingSender()
    await requestPasswordReset(db, email, { linkFor, send: mail.send })
    const token = mail.lastToken()

    const page = await get(`/auth/reset?token=${token}`)
    assert.equal(page.status, 200)
    assert.match(page.body, /name="new_password"/)

    const short = await post('/auth/reset', { token, new_password: 'short', confirm_password: 'short' })
    assert.equal(short.status, 400)
    const mismatch = await post('/auth/reset', { token, new_password: NEW, confirm_password: `${NEW}x` })
    assert.equal(mismatch.status, 400)
    assert.match(mismatch.body, /don(&#39;|')t match/)

    const done = await post('/auth/reset', { token, new_password: NEW, confirm_password: NEW })
    assert.equal(done.status, 303)
    const newCookie = sessionCookieFrom(done)
    assert.ok(newCookie)
    assert.equal((await get('/profile', newCookie)).status, 200)

    // The cookie from before the reset no longer gets in.
    const stale = await get('/profile', oldCookie)
    assert.equal(stale.status, 303)
    assert.ok(stale.location?.startsWith('/auth/login'))

    assert.equal(await login(OLD), null)
    assert.ok(await login(NEW))

    // And the link is spent.
    assert.equal((await get(`/auth/reset?token=${token}`)).status, 410)
  })

  it('changing the password on the profile keeps you in and logs out other devices', async () => {
    const here = await login(NEW)
    const elsewhere = await login(NEW)
    assert.ok(here && elsewhere)

    const changed = await post(
      '/profile/password',
      { _method: 'PUT', current_password: NEW, new_password: OLD, confirm_password: OLD },
      here,
    )
    assert.equal(changed.status, 303)
    const reissued = sessionCookieFrom(changed)
    assert.ok(reissued)

    assert.equal((await get('/profile', reissued)).status, 200)
    assert.equal((await get('/profile', elsewhere)).status, 303)
  })
})
