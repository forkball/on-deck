import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { logger, withLogContext } from '../app/log.ts'

// The lines were readable before this; what they could not say is which run they came
// from. A generation run makes up to 18 catalog searches, and when Google Books
// answered 503 eleven times the only way to tie that to the run it emptied was to
// compare timestamps against the job table by hand.
describe('logger', () => {
  const written: string[] = []
  const real = { info: console.info, warn: console.warn, error: console.error }

  beforeEach(() => {
    written.length = 0
    for (const level of ['info', 'warn', 'error'] as const) {
      console[level] = (...args: unknown[]) => void written.push(args.map(String).join(' '))
    }
  })

  afterEach(() => Object.assign(console, real))

  it('names the part of the app that spoke', () => {
    logger('catalog').warn('Google Books responded 503')

    assert.equal(written[0], '[catalog] Google Books responded 503')
  })

  it('carries the context it was called inside', () => {
    withLogContext({ job: 'abc-123' }, () => logger('catalog').warn('attempt 1/6 failed'))

    assert.equal(written[0], '[catalog] attempt 1/6 failed (job=abc-123)')
  })

  // The point of async-local context: the catalog client is four layers below the
  // worker and knows nothing about runs, and its line still says which run it was for.
  it('reaches code that never heard of a run', async () => {
    const deepInsideTheCatalogClient = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      logger('catalog').warn('responded 503')
    }

    await withLogContext({ job: 'abc-123' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      await deepInsideTheCatalogClient()
    })

    assert.equal(written[0], '[catalog] responded 503 (job=abc-123)')
  })

  it('merges an inner scope into the outer one rather than replacing it', () => {
    withLogContext({ job: 'abc-123' }, () => {
      withLogContext({ batch: 7 }, () => logger('import').info('staged 40 rows'))
    })

    assert.equal(written[0], '[import] staged 40 rows (job=abc-123 batch=7)')
  })

  it('says nothing extra outside any context', () => {
    logger('generation').info('picks 18 → kept 8')

    assert.equal(written[0], '[generation] picks 18 → kept 8')
  })

  it('passes the cause through, so a stack still reaches the log', () => {
    const cause = new Error('socket hang up')
    withLogContext({ job: 'abc-123' }, () => logger('catalog').error('lookup failed', cause))

    assert.equal(written[0], `[catalog] lookup failed (job=abc-123) ${cause}`)
  })
})
