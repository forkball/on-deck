import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CandidateLike } from '../app/data/imports/classify.ts'
import { resolveBatch, type MatchInput } from '../app/data/imports/resolve.ts'

function film(externalId: string, title: string, releaseYear: number | null): CandidateLike {
  return { externalId, title, releaseYear }
}

const tarkovsky = film('tmdb-1', 'Solaris', 1972)
const soderbergh = film('tmdb-2', 'Solaris', 2002)
const solarisResults = [tarkovsky, soderbergh]

function input(rowId: number, title: string, year: number | null, results: CandidateLike[]): MatchInput {
  return { rowId, title, year, results }
}

describe('resolveBatch', () => {
  it('gives each row the film its own year points at', () => {
    const outcomes = resolveBatch([
      input(41, 'Solaris', 1972, solarisResults),
      input(288, 'Solaris', 2002, solarisResults),
    ])

    assert.equal(outcomes[0].chosen?.externalId, 'tmdb-1')
    assert.equal(outcomes[1].chosen?.externalId, 'tmdb-2')
    assert.equal(outcomes[0].verdict.state, 'confident')
    assert.equal(outcomes[1].verdict.state, 'confident')
  })

  it('will not let a nearest-year fallback take an exact match away', () => {
    // Row 288 has no 2004 release to land on, so the old per-row matcher would
    // have handed it the 1972 film that row 41 matched exactly.
    const outcomes = resolveBatch([
      input(41, 'Solaris', 1972, [tarkovsky]),
      input(288, 'Solaris', 2004, [tarkovsky]),
    ])

    assert.equal(outcomes[0].chosen?.externalId, 'tmdb-1')
    assert.equal(outcomes[1].chosen, null)
    assert.equal(outcomes[1].verdict.state, 'not_found')
  })

  it('settles exact matches first however the rows are ordered', () => {
    const outcomes = resolveBatch([
      input(288, 'Solaris', 2004, [tarkovsky]),
      input(41, 'Solaris', 1972, [tarkovsky]),
    ])

    assert.equal(outcomes[1].chosen?.externalId, 'tmdb-1')
    assert.equal(outcomes[0].chosen, null)
  })

  it('lets a fallback take the next entry rather than giving up', () => {
    const other = film('tmdb-9', 'Solaris', 1968)
    const outcomes = resolveBatch([
      input(41, 'Solaris', 1972, [tarkovsky, other]),
      input(288, 'Solaris', 1969, [tarkovsky, other]),
    ])

    assert.equal(outcomes[1].chosen?.externalId, 'tmdb-9')
    assert.equal(outcomes[1].verdict.reason, 'year_drift')
  })

  it('still lets two exact rows share one film, so a rewatch stays visible', () => {
    const drive = film('tmdb-3', 'Drive', 2011)
    const outcomes = resolveBatch([
      input(12, 'Drive', 2011, [drive]),
      input(210, 'Drive', 2011, [drive]),
    ])

    // Forcing these apart would invent a wrong match to dodge a question the
    // review page is built to ask.
    assert.equal(outcomes[0].chosen?.externalId, 'tmdb-3')
    assert.equal(outcomes[1].chosen?.externalId, 'tmdb-3')
  })

  it('takes the first result for a row with no year to go on', () => {
    const outcomes = resolveBatch([input(7, 'Solaris', null, solarisResults)])

    assert.equal(outcomes[0].chosen?.externalId, 'tmdb-1')
    assert.equal(outcomes[0].verdict.reason, 'no_year')
  })

  it('reports nothing found when the catalog returned nothing', () => {
    const outcomes = resolveBatch([input(1, 'Ne Zha 2', 2025, [])])

    assert.equal(outcomes[0].chosen, null)
    assert.equal(outcomes[0].verdict.state, 'not_found')
  })

  it('returns one outcome per row, in the order given', () => {
    const outcomes = resolveBatch([
      input(3, 'Drive', 2011, []),
      input(1, 'Solaris', 1972, solarisResults),
      input(2, 'Heat', 1995, []),
    ])

    assert.deepEqual(outcomes.map((o) => o.rowId), [3, 1, 2])
  })
})

describe('rows identified by ISBN', () => {
  it('takes the catalog result without arguing about the title', () => {
    const [outcome] = resolveBatch([
      {
        rowId: 1,
        title: 'Dune',
        year: 1965,
        identified: true,
        // What the catalog actually returns for the ISBN: a subtitled reprint
        // whose year is the printing, not the work.
        results: [{ externalId: 'g1', title: 'Dune: Deluxe Edition', releaseYear: 2019 }],
      },
    ])

    assert.equal(outcome.chosen?.externalId, 'g1')
    assert.equal(outcome.verdict.state, 'confident')
  })

  it('holds its entry against a title match that wants the same one', () => {
    const outcomes = resolveBatch([
      {
        rowId: 1,
        title: 'Dune',
        year: 1965,
        identified: true,
        results: [{ externalId: 'g1', title: 'Dune: Deluxe Edition', releaseYear: 2019 }],
      },
      {
        rowId: 2,
        title: 'Dune',
        year: 1965,
        results: [{ externalId: 'g1', title: 'Dune: Deluxe Edition', releaseYear: 2019 }],
      },
    ])

    assert.equal(outcomes[0].chosen?.externalId, 'g1')
    assert.equal(outcomes[1].chosen, null, 'the second row may not take an identified row entry')
  })

  it('falls through when the identifier found nothing at all', () => {
    const [outcome] = resolveBatch([{ rowId: 1, title: 'Dune', year: 1965, identified: true, results: [] }])

    assert.equal(outcome.chosen, null)
    assert.equal(outcome.verdict.state, 'not_found')
  })
})
