import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseIdParam } from '../app/actions/route-params.ts'

describe('parseIdParam', () => {
  it('reads a positive integer', () => {
    assert.equal(parseIdParam('1'), 1)
    assert.equal(parseIdParam('42'), 42)
    assert.equal(parseIdParam('2147483647'), 2147483647)
  })

  for (const value of ['', 'abc', '0', '-1', '1.5', '1e3', ' 1', '01', '0x10', '2147483648', '99999999999']) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      assert.equal(parseIdParam(value), null)
    })
  }

  it('refuses a missing param', () => {
    assert.equal(parseIdParam(undefined), null)
  })
})
