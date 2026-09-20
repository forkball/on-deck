import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Auth } from 'remix/middleware/auth'

import controller, { describeSync } from '../app/actions/profile/letterboxd/controller.tsx'
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

// What Sync now puts on the page. The counts are the point: someone presses
// this because they want to know whether the feed carries an entry, and a
// number that moves between two presses is the only thing that answers that.
describe('what a manual sync reports', () => {
  it('counts the entries it read', () => {
    assert.equal(
      describeSync({ logged: 47, unresolved: 0, deleted: 0 }),
      'Read 47 diary entries from Letterboxd.',
    )
  })

  it('names removals rather than leaving them to be noticed', () => {
    assert.equal(
      describeSync({ logged: 46, unresolved: 0, deleted: 2 }),
      'Read 46 diary entries from Letterboxd. Removed 2 films your diary no longer lists.',
    )
  })

  // An entry the catalog can't place is a film that will never show up here,
  // and this count is the only sign of it.
  it('admits what it could not match', () => {
    assert.equal(
      describeSync({ logged: 45, unresolved: 3, deleted: 1 }),
      "Read 45 diary entries from Letterboxd. Removed 1 film your diary no longer lists. 3 entries couldn't be matched to a film.",
    )
  })

  it('reads as one of each rather than 1 films', () => {
    assert.equal(
      describeSync({ logged: 1, unresolved: 1, deleted: 1 }),
      "Read 1 diary entry from Letterboxd. Removed 1 film your diary no longer lists. 1 entry couldn't be matched to a film.",
    )
  })

  // A diary of nothing but lists, or a name that isn't publishing yet. Saying
  // "0 entries" invites the reading that something broke on our side.
  it('explains an empty feed instead of counting it', () => {
    assert.match(describeSync({ logged: 0, unresolved: 0, deleted: 0 }), /isn't publishing any diary entries/)
  })
})
