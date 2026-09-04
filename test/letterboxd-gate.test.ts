import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Auth } from 'remix/middleware/auth'

import controller from '../app/actions/profile/letterboxd/controller.tsx'
import type { User } from '../app/data/schema.ts'

// The connect routes are gated twice over — by LETTERBOXD_FEED_SYNC and by
// is_admin — and the gate only works if it runs behind requireAuth. That is an
// ordering, which nothing but a test notices when it changes, so this drives
// the controller's real middleware list rather than the gate on its own.
const REACHED = new Response('reached the action', { status: 200 })

function dispatch(chain: readonly unknown[], context: unknown, index: number): Promise<Response> {
  if (index >= chain.length) return Promise.resolve(REACHED)
  const middleware = chain[index] as (c: unknown, next: () => Promise<Response>) => Promise<Response>
  return middleware(context, () => dispatch(chain, context, index + 1))
}

// Only what the two middlewares actually touch: the auth state loadAuth() puts
// on every request, the `set` requireAuth uses to narrow it, and the url its
// login redirect is built from.
async function runGate(options: { signedIn: boolean; isAdmin?: boolean }): Promise<Response> {
  const identity = { id: 1, is_admin: options.isAdmin ?? false } as User
  const values = new Map<unknown, unknown>([
    [Auth, options.signedIn ? { ok: true, identity, method: 'session' } : { ok: false }],
  ])

  const context = {
    get: (key: unknown) => values.get(key),
    set: (key: unknown, value: unknown) => values.set(key, value),
    url: new URL('http://localhost/profile/letterboxd/connect'),
  }

  return dispatch(controller.middleware ?? [], context, 0)
}

function withFlag<T>(value: string | undefined, read: () => Promise<T>): Promise<T> {
  const original = process.env.LETTERBOXD_FEED_SYNC
  if (value === undefined) delete process.env.LETTERBOXD_FEED_SYNC
  else process.env.LETTERBOXD_FEED_SYNC = value

  return read().finally(() => {
    if (original === undefined) delete process.env.LETTERBOXD_FEED_SYNC
    else process.env.LETTERBOXD_FEED_SYNC = original
  })
}

describe('the Letterboxd connect routes', () => {
  it('sends an anonymous visitor to log in rather than answering 404', async () => {
    const response = await withFlag(undefined, () => runGate({ signedIn: false }))

    // The whole point of the ordering: reached first, the gate would 404
    // someone who is simply not signed in yet.
    assert.equal(response.status, 303)
    assert.match(response.headers.get('location') ?? '', /\/auth\/login/)
  })

  it('is closed to an ordinary member while the flag is unset', async () => {
    const response = await withFlag(undefined, () => runGate({ signedIn: true }))

    // 404, not 403: a gated feature shouldn't advertise that it exists.
    assert.equal(response.status, 404)
  })

  it('is open to an admin even then, which is what makes a production beta possible', async () => {
    const response = await withFlag(undefined, () => runGate({ signedIn: true, isAdmin: true }))

    assert.equal(response, REACHED)
  })

  it('is open to an ordinary member once the flag is set', async () => {
    const response = await withFlag('1', () => runGate({ signedIn: true }))

    assert.equal(response, REACHED)
  })
})
