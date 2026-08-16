import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyVerdicts, matchesDecade, titlesLikelyMatch, type Candidate } from '../app/data/recommendations/matching.ts'

describe('titlesLikelyMatch', () => {
  it('accepts the same title', () => {
    assert.ok(titlesLikelyMatch('Dune', 'Dune'))
  })

  it('ignores punctuation, case and spacing', () => {
    assert.ok(titlesLikelyMatch('WALL-E', 'Wall E'))
    assert.ok(titlesLikelyMatch('the thing', 'The Thing'))
  })

  it('accepts a catalog subtitle the pick did not ask for', () => {
    assert.ok(titlesLikelyMatch('The Dispossessed', 'The Dispossessed: An Ambiguous Utopia'))
  })

  it('rejects a prefix that is a different work', () => {
    assert.ok(!titlesLikelyMatch('Foundation', 'Foundation and Empire'))
  })

  it('rejects an unrelated title', () => {
    assert.ok(!titlesLikelyMatch('Dune', 'The Godfather'))
  })

  it('rejects empty input rather than matching everything', () => {
    assert.ok(!titlesLikelyMatch('', 'Dune'))
    assert.ok(!titlesLikelyMatch('Dune', ''))
  })
})

describe('matchesDecade', () => {
  it('defaults to within the decade', () => {
    assert.ok(matchesDecade(1995, 1990))
    assert.ok(!matchesDecade(2001, 1990))
    assert.ok(!matchesDecade(1989, 1990))
  })

  it('reads before and after as exclusive of the decade itself', () => {
    assert.ok(matchesDecade(1989, 1990, 'before'))
    assert.ok(!matchesDecade(1995, 1990, 'before'))
    assert.ok(matchesDecade(2000, 1990, 'after'))
    assert.ok(!matchesDecade(1999, 1990, 'after'))
  })

  it('never matches an unknown year', () => {
    for (const relation of ['before', 'within', 'after'] as const) {
      assert.ok(!matchesDecade(null, 1990, relation))
    }
  })
})

// Verdicts pair with candidates by index, not by position. This is the step
// whose job is telling near-identical entries apart, so a set it cannot read
// unambiguously has to be refused rather than filtered on a best guess.
const candidate = (title: string): Candidate =>
  ({ pick: { title, year: 2000, reason: '' }, match: { title } }) as unknown as Candidate

describe('applyVerdicts', () => {
  const three = [candidate('a'), candidate('b'), candidate('c')]

  it('keeps only the entries the model approved', () => {
    const kept = applyVerdicts(three, [
      { index: 0, matches: true },
      { index: 1, matches: false },
      { index: 2, matches: true },
    ])
    assert.deepEqual(kept.map((c) => c.pick.title), ['a', 'c'])
  })

  it('pairs by index, not by arrival order', () => {
    const kept = applyVerdicts(three, [
      { index: 2, matches: false },
      { index: 0, matches: true },
      { index: 1, matches: true },
    ])
    assert.deepEqual(kept.map((c) => c.pick.title), ['a', 'b'])
  })

  it('refuses a short verdict list rather than sliding answers onto the wrong entry', () => {
    assert.throws(() => applyVerdicts(three, [
      { index: 0, matches: true },
      { index: 1, matches: true },
    ]))
  })

  it('refuses an out-of-range index', () => {
    assert.throws(() => applyVerdicts(three, [
      { index: 0, matches: true },
      { index: 1, matches: true },
      { index: 9, matches: true },
    ]))
  })

  it('refuses a duplicate verdict', () => {
    assert.throws(() => applyVerdicts(three, [
      { index: 0, matches: true },
      { index: 0, matches: false },
      { index: 1, matches: true },
    ]))
  })

  it('refuses a non-array', () => {
    assert.throws(() => applyVerdicts(three, null as never))
  })

  it('returns nothing for no candidates', () => {
    assert.deepEqual(applyVerdicts([], []), [])
  })
})
