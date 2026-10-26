import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pollDelay } from '../app/data/imports/worker.ts'

describe('import worker poll delay', () => {
  it('polls at the idle rate while ticks succeed', () => {
    assert.equal(pollDelay(0), 2000)
  })

  it('doubles the wait for each failure in a row', () => {
    assert.deepEqual([1, 2, 3, 4].map(pollDelay), [4000, 8000, 16000, 32000])
  })

  it('never waits longer than a minute', () => {
    assert.equal(pollDelay(5), 60_000)
    assert.equal(pollDelay(50), 60_000)
  })
})
