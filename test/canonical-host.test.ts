import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { canonicalHost } from '../app/middleware/canonicalHost.ts'

describe('canonicalHost', () => {
  const passed = new Response('page')

  const run = (url: string, canonical: string | undefined, method = 'GET') =>
    canonicalHost(canonical)(
      { request: new Request(url, { method }) } as never,
      (async () => passed) as never,
    )

  it("sends Fly's own address to the real domain, keeping the path and query", async () => {
    const response = await run('http://on-deck.fly.dev/books/7?tab=log', 'whatsondeck.net')

    assert.equal(response.status, 308)
    assert.equal(response.headers.get('Location'), 'https://whatsondeck.net/books/7?tab=log')
  })

  it('sends www to the bare domain', async () => {
    const response = await run('https://www.whatsondeck.net/', 'whatsondeck.net')

    assert.equal(response.headers.get('Location'), 'https://whatsondeck.net/')
  })

  it('keeps the method, so a form posted mid-switch still lands', async () => {
    const response = await run('https://on-deck.fly.dev/auth/login', 'whatsondeck.net', 'POST')

    assert.equal(response.status, 308)
  })

  it('leaves the real domain alone', async () => {
    assert.equal(await run('https://whatsondeck.net/', 'whatsondeck.net'), passed)
  })

  // A stray CANONICAL_HOST in a local .env must not bounce development to production.
  it('leaves hosts it does not know alone', async () => {
    assert.equal(await run('http://localhost:44100/', 'whatsondeck.net'), passed)
  })

  // Unset until the certificate is issued, and redirecting before then would
  // send everyone to a domain that can't serve them.
  it('does nothing until a domain is configured', async () => {
    assert.equal(await run('http://on-deck.fly.dev/', undefined), passed)
  })
})
