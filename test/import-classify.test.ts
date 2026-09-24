import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  classifyDuplicate,
  classifyMatch,
  conflictFields,
  describeReason,
  inlineAlternates,
  isBulkAcceptable,
  reasonGroup,
  suspicion,
  type CandidateLike,
  type DuplicateRow,
  type LogValues,
} from '../app/data/imports/classify.ts'

function film(title: string, releaseYear: number | null, externalId = title): CandidateLike {
  return { externalId, title, releaseYear }
}

describe('classifyMatch', () => {
  it('is confident when title and year both agree', () => {
    const verdict = classifyMatch({ title: 'Heat', year: 1995 }, film('Heat', 1995))
    assert.equal(verdict.state, 'confident')
    assert.equal(verdict.reason, 'exact')
  })

  it('ignores punctuation and case when comparing titles', () => {
    const verdict = classifyMatch({ title: 'wall-e', year: 2008 }, film('WALL·E', 2008))
    assert.equal(verdict.state, 'confident')
  })

  it('flags a year gap and keeps its size', () => {
    const verdict = classifyMatch({ title: 'The Thing', year: 1982 }, film('The Thing', 2011))
    assert.equal(verdict.state, 'uncertain')
    assert.equal(verdict.reason, 'year_drift')
    assert.equal(verdict.yearDelta, 29)
  })

  it('flags a row with no year, however good the title', () => {
    const verdict = classifyMatch({ title: 'Solaris', year: null }, film('Solaris', 2002))
    assert.equal(verdict.state, 'uncertain')
    assert.equal(verdict.reason, 'no_year')
  })

  it('flags a title that only matched loosely', () => {
    const verdict = classifyMatch({ title: 'Solyaris', year: 1972 }, film('Solaris', 1972))
    assert.equal(verdict.state, 'uncertain')
    assert.equal(verdict.reason, 'title_differs')
  })

  // These used to be flagged for review. The card had no way to show which
  // rival film it meant, so it asked a question it gave no means to answer.
  it('trusts an exact match even when several results tie on it', () => {
    const results = [film('Drive', 2011, 'a'), film('Drive', 2011, 'b')]
    const verdict = classifyMatch({ title: 'Drive', year: 2011 }, results[0])
    assert.equal(verdict.state, 'confident')
    assert.equal(verdict.reason, 'exact')
  })

  it('reports nothing found rather than inventing a reason', () => {
    const verdict = classifyMatch({ title: 'Ne Zha 2', year: 2025 }, null)
    assert.equal(verdict.state, 'not_found')
    assert.equal(verdict.reason, null)
  })
})

describe('suspicion', () => {
  it('sorts a wrong-looking title above any year gap', () => {
    const titleDiffers = classifyMatch({ title: 'Solyaris', year: 1972 }, film('Solaris', 1972))
    const bigDrift = classifyMatch({ title: 'The Thing', year: 1982 }, film('The Thing', 2011))
    assert.ok(suspicion(titleDiffers) > suspicion(bigDrift))
  })

  it('sorts a wide year gap above a narrow one', () => {
    const wide = classifyMatch({ title: 'The Thing', year: 1982 }, film('The Thing', 2011))
    const narrow = classifyMatch({ title: 'Kwaidan', year: 1964 }, film('Kwaidan', 1965))
    assert.ok(suspicion(wide) > suspicion(narrow))
  })

  it('leaves confident rows at the bottom', () => {
    const exact = classifyMatch({ title: 'Heat', year: 1995 }, film('Heat', 1995))
    assert.equal(suspicion(exact), 0)
  })
})

describe('isBulkAcceptable', () => {
  it('covers the off-by-one tail', () => {
    assert.ok(isBulkAcceptable(classifyMatch({ title: 'Kwaidan', year: 1964 }, film('Kwaidan', 1965))))
  })

  it('does not sweep up a wide gap', () => {
    assert.ok(!isBulkAcceptable(classifyMatch({ title: 'The Thing', year: 1982 }, film('The Thing', 2011))))
  })

  it('does not sweep up a different-looking title', () => {
    assert.ok(!isBulkAcceptable(classifyMatch({ title: 'Solyaris', year: 1972 }, film('Solaris', 1972))))
  })
})

function dupe(
  id: number,
  title: string,
  year: number | null,
  consumedAt: number | null,
  match: CandidateLike,
): DuplicateRow {
  return { id, index: id, title, year, consumedAt, verdict: classifyMatch({ title, year }, match) }
}

describe('classifyDuplicate', () => {
  const tarkovsky = film('Solaris', 1972)

  it('reads two different years as two different films', () => {
    const verdict = classifyDuplicate(
      dupe(41, 'Solaris', 1972, 0, tarkovsky),
      dupe(288, 'Solaris', 2002, 0, tarkovsky),
    )
    assert.equal(verdict.kind, 'different_films')
    if (verdict.kind !== 'different_films') return
    // The row the match agrees with stays put; the drifted one moves.
    assert.equal(verdict.anchor.id, 41)
    assert.equal(verdict.move.id, 288)
  })

  it('picks the same mover whichever order the rows arrive in', () => {
    const verdict = classifyDuplicate(
      dupe(288, 'Solaris', 2002, 0, tarkovsky),
      dupe(41, 'Solaris', 1972, 0, tarkovsky),
    )
    assert.equal(verdict.kind, 'different_films')
    if (verdict.kind !== 'different_films') return
    assert.equal(verdict.move.id, 288)
  })

  it('reads the same title and year as one film logged twice', () => {
    const drive = film('Drive', 2011)
    const verdict = classifyDuplicate(
      dupe(12, 'Drive', 2011, 1_700_000_000_000, drive),
      dupe(210, 'Drive', 2011, 1_730_000_000_000, drive),
    )
    assert.equal(verdict.kind, 'repeat')
    if (verdict.kind !== 'repeat') return
    // One entry per film means the later viewing is the live one.
    assert.equal(verdict.keep.id, 210)
    assert.equal(verdict.drop.id, 12)
  })
})

describe('describeReason', () => {
  it('names the gap without a stray plural', () => {
    assert.equal(
      describeReason(classifyMatch({ title: 'Kwaidan', year: 1964 }, film('Kwaidan', 1965))),
      'Year off by 1',
    )
    assert.equal(
      describeReason(classifyMatch({ title: 'The Thing', year: 1982 }, film('The Thing', 2011))),
      'Year off by 29',
    )
  })

  it('says nothing about a confident match', () => {
    assert.equal(describeReason(classifyMatch({ title: 'Heat', year: 1995 }, film('Heat', 1995))), null)
  })

  // The group heading already says these; a chip repeating it on every card
  // is noise.
  it('leaves reasons its group heading names to the heading', () => {
    assert.equal(describeReason(classifyMatch({ title: 'Heat', year: null }, film('Heat', 1995))), null)
    assert.equal(
      describeReason(classifyMatch({ title: 'Birdman', year: 2014 }, film('Birdman or…', 2014))),
      null,
    )
  })
})

describe('reasonGroup', () => {
  it('uses the media noun it is given', () => {
    assert.match(reasonGroup('no_year', 'book', 'books').blurb, /Several books/)
  })

  it('has a fallback for a reason without its own group', () => {
    assert.equal(reasonGroup(null, 'movie', 'movies').title, 'Worth checking')
  })
})

const logged: LogValues = {
  rating: 4.5,
  disliked: null,
  consumedAt: Date.parse('2023-03-12T09:00:00Z'),
  notes: 'still the best shootout',
}

describe('conflictFields', () => {
  it('raises nothing when the import agrees', () => {
    assert.deepEqual(conflictFields(logged, { ...logged }), [])
  })

  it('treats the same day written at a different hour as agreement', () => {
    const incoming = { ...logged, consumedAt: Date.parse('2023-03-12T23:30:00Z') }
    assert.deepEqual(conflictFields(logged, incoming), [])
  })

  it('names only the field that differs', () => {
    assert.deepEqual(conflictFields(logged, { ...logged, rating: 4 }), ['rating'])
    assert.deepEqual(conflictFields(logged, { ...logged, consumedAt: Date.parse('2024-09-19T00:00:00Z') }), [
      'watched',
    ])
  })

  it('counts a dislike as a rating disagreement', () => {
    assert.deepEqual(conflictFields(logged, { ...logged, rating: null, disliked: true }), ['rating'])
  })

  it('ignores whitespace-only note changes', () => {
    assert.deepEqual(conflictFields(logged, { ...logged, notes: '  still the best shootout  ' }), [])
  })
})

describe('inlineAlternates', () => {
  const row = { title: 'Little Women', year: null }
  const noYear = classifyMatch(row, film('Little Women', 2019, 'lw19'))

  it('offers the namesakes of a no-year row, our pick first', () => {
    const results = [film('Little Women', 1994, 'lw94'), film('Little Women', 2019, 'lw19')]
    const alternates = inlineAlternates(row, noYear, film('Little Women', 2019, 'lw19'), results)
    assert.deepEqual(
      alternates?.map((a) => a.externalId),
      ['lw19', 'lw94'],
    )
  })

  it('leaves out results that only contain the title', () => {
    const results = [film('Little Women', 1994, 'lw94'), film('Little Women: LA Story', 2016, 'la')]
    const alternates = inlineAlternates(row, noYear, film('Little Women', 2019, 'lw19'), results)
    assert.deepEqual(
      alternates?.map((a) => a.externalId),
      ['lw19', 'lw94'],
    )
  })

  it('is nothing to choose between when there is only one namesake', () => {
    const results = [film('Little Women: LA Story', 2016, 'la')]
    assert.equal(inlineAlternates(row, noYear, film('Little Women', 2019, 'lw19'), results), null)
  })

  it('hands a long list of namesakes to the picker instead', () => {
    const results = [1933, 1949, 1994, 2018].map((year) => film('Little Women', year, `lw${year}`))
    assert.equal(inlineAlternates(row, noYear, film('Little Women', 2019, 'lw19'), results), null)
  })

  it('only applies to rows flagged for having no year', () => {
    const drift = classifyMatch({ title: 'Nosferatu', year: 2025 }, film('Nosferatu', 2024, 'n24'))
    const results = [film('Nosferatu', 2024, 'n24'), film('Nosferatu', 1922, 'n22')]
    assert.equal(inlineAlternates({ title: 'Nosferatu', year: 2025 }, drift, results[0]!, results), null)
  })
})
