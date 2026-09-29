import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { accessLog } from '../app/middleware/accessLog.ts'

// An app serving pages used to log nothing at all, which reads exactly like a broken
// log pipeline — and was mistaken for one. A request that isn't a search, a run or a
// failure now leaves one line saying what it was.
describe('accessLog', () => {
  const written: string[] = []
  const real = { info: console.info, error: console.error }

  beforeEach(() => {
    written.length = 0
    console.info = (...args: unknown[]) => void written.push(args.map(String).join(' '))
    console.error = (...args: unknown[]) => void written.push(args.map(String).join(' '))
  })

  afterEach(() => Object.assign(console, real))

  const run = (path: string, respond: () => Promise<Response>) =>
    accessLog()({ request: new Request(`http://localhost${path}`) } as never, respond as never)

  it('says what was asked for and what came back', async () => {
    await run('/recommendations', async () => new Response('ok', { status: 200 }))

    assert.match(written[0], /^\[http\] GET \/recommendations 200 \d+ms$/)
  })

  it('records a status nobody would otherwise see', async () => {
    await run('/nope', async () => new Response('', { status: 404 }))

    assert.match(written[0], /GET \/nope 404/)
  })

  // The framework turns a throw into a 500 after this runs, with a stack that does
  // not say which URL caused it.
  it('names the request that threw, and lets the throw through', async () => {
    const boom = new Error('kaboom')
    await assert.rejects(
      async () =>
        run('/books/7', async () => {
          throw boom
        }),
      boom,
    )

    assert.match(written[0], /GET \/books\/7 failed after \d+ms/)
  })

  it('stays quiet for static files, which are most of the requests and none of the questions', async () => {
    await run('/assets/app.css', async () => new Response('', { status: 200 }))
    await run('/favicon.ico', async () => new Response('', { status: 200 }))

    assert.deepEqual(written, [])
  })
})
