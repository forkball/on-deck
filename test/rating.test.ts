import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DISLIKED_INPUT_VALUE,
  normalizeRating,
  parseRatingInput,
  parseRatingSubmission,
} from '../app/data/mediaItems.ts'

// The scale runs 0.5-5 in half-star steps, and 0 is not the bottom of it —
// "never rated" and "rated the lowest it goes" are different claims.
describe('normalizeRating', () => {
  it('keeps every valid half-star step', () => {
    for (const value of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      assert.equal(normalizeRating(value), value)
    }
  })

  it('reads anything at or below zero as unrated', () => {
    assert.equal(normalizeRating(0), null)
    assert.equal(normalizeRating(-1), null)
    assert.equal(normalizeRating(0.2), null, '0.2 rounds to 0, which is not on the scale')
  })

  it('reads absent and non-finite input as unrated', () => {
    assert.equal(normalizeRating(null), null)
    assert.equal(normalizeRating(undefined), null)
    assert.equal(normalizeRating(NaN), null)
    assert.equal(normalizeRating(Infinity), null)
  })

  it('snaps to the nearest half step and caps at 5', () => {
    assert.equal(normalizeRating(3.3), 3.5)
    assert.equal(normalizeRating(3.2), 3)
    assert.equal(normalizeRating(9), 5)
  })
})

describe('parseRatingInput', () => {
  it('treats an empty submission as unrated rather than zero', () => {
    assert.equal(parseRatingInput(''), null)
    assert.equal(parseRatingInput('   '), null)
  })

  it('parses a submitted score', () => {
    assert.equal(parseRatingInput('4.5'), 4.5)
  })

  it('refuses a tampered value instead of storing it', () => {
    assert.equal(parseRatingInput('banana'), null)
    assert.equal(parseRatingInput('-3'), null)
  })
})

// One field in, two mutually exclusive columns out. A row must never claim a
// score and a dislike at once.
describe('parseRatingSubmission', () => {
  it('maps the dislike sentinel to disliked, never to a score', () => {
    assert.deepEqual(parseRatingSubmission(DISLIKED_INPUT_VALUE), { rating: null, disliked: true })
  })

  it('maps a score to a rating and leaves the verdict unstated', () => {
    assert.deepEqual(parseRatingSubmission('4'), { rating: 4, disliked: null })
  })

  it('maps an empty submission to neither', () => {
    assert.deepEqual(parseRatingSubmission(''), { rating: null, disliked: null })
  })

  it('never returns a rating and a dislike together', () => {
    for (const raw of [DISLIKED_INPUT_VALUE, '', '0', '5', 'banana', '-2']) {
      const { rating, disliked } = parseRatingSubmission(raw)
      assert.ok(!(rating != null && disliked === true), `both set for ${JSON.stringify(raw)}`)
    }
  })
})
