import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pick } from '../app/data/recommendations/picks.ts'
import {
  parseUnmatchedPicks,
  selectUnmatchedPicks,
  type UnmatchedCandidate,
} from '../app/data/recommendations/unmatched.ts'

const pick = (title: string, extra: Partial<Pick> = {}): Pick => ({
  title,
  year: 1980,
  reason: `Because of ${title}.`,
  ...extra,
})

const candidate = (title: string, seriesKey: string | null = null, extra: Partial<Pick> = {}) =>
  ({ pick: pick(title, extra), seriesKey }) satisfies UnmatchedCandidate

const select = (overrides: Partial<Parameters<typeof selectUnmatchedPicks>[0]> = {}) =>
  selectUnmatchedPicks({
    candidates: [],
    excluded: { seen: [], rejected: [] },
    shownTitles: [],
    takenSeries: new Set(),
    slots: 8,
    ...overrides,
  })

describe('selectUnmatchedPicks', () => {
  it("keeps the model's own answer, in the order it ranked them", () => {
    const kept = select({
      candidates: [
        candidate('The Book of the New Sun', null, { creator: 'Gene Wolfe' }),
        candidate('Engine Summer'),
      ],
    })
    assert.deepEqual(kept, [
      {
        title: 'The Book of the New Sun',
        year: 1980,
        creator: 'Gene Wolfe',
        reason: 'Because of The Book of the New Sun.',
      },
      { title: 'Engine Summer', year: 1980, creator: undefined, reason: 'Because of Engine Summer.' },
    ])
  })

  // Without a catalog id the id filter can't see these, so a book someone has
  // read would come straight back to them unless the title is compared.
  it('leaves out what the group has already seen or turned down, by title', () => {
    const kept = select({
      candidates: [candidate('Fire & Blood'), candidate('Piranesi'), candidate('Hyperion')],
      excluded: { seen: ['Fire and Blood'], rejected: ['piranesi'] },
    })
    assert.deepEqual(
      kept.map((entry) => entry.title),
      ['Hyperion'],
    )
  })

  it('does not repeat a work the run already shows from the catalog', () => {
    const kept = select({
      candidates: [candidate('Twelfth Night: Or, What You Will'), candidate('Hamnet')],
      shownTitles: ['Twelfth Night, or What You Will'],
    })
    assert.deepEqual(
      kept.map((entry) => entry.title),
      ['Hamnet'],
    )
  })

  it('does not list the same work twice', () => {
    const kept = select({ candidates: [candidate('Dune'), candidate('DUNE')] })
    assert.equal(kept.length, 1)
  })

  it('keeps one per series, counting the confirmed picks', () => {
    const kept = select({
      candidates: [
        candidate('Iron Flame', 'the empyrean'),
        candidate('Mistborn', 'mistborn'),
        candidate('The Well of Ascension', 'mistborn'),
      ],
      takenSeries: new Set(['the empyrean']),
    })
    assert.deepEqual(
      kept.map((entry) => entry.title),
      ['Mistborn'],
    )
  })

  it('fills only the places the confirmed picks leave', () => {
    const candidates = ['A', 'B', 'C', 'D'].map((title) => candidate(`Title ${title}`))
    assert.equal(select({ candidates, slots: 2 }).length, 2)
    assert.deepEqual(select({ candidates, slots: 0 }), [])
  })

  it('drops a year the model left out or got nonsensical', () => {
    const [kept] = select({ candidates: [candidate('Untitled', null, { year: 0 })] })
    assert.equal(kept?.year, null)
  })
})

describe('parseUnmatchedPicks', () => {
  it('reads back what was stored', () => {
    const stored = [
      { title: 'Engine Summer', year: 1979, creator: 'John Crowley', reason: 'Quiet and strange.' },
    ]
    assert.deepEqual(parseUnmatchedPicks(JSON.stringify(stored)), stored)
  })

  it('reads a malformed or missing column as empty', () => {
    assert.deepEqual(parseUnmatchedPicks(null), [])
    assert.deepEqual(parseUnmatchedPicks('not json'), [])
    assert.deepEqual(parseUnmatchedPicks('{"title":"x"}'), [])
  })

  it('skips entries without a title rather than rendering a blank row', () => {
    const raw = JSON.stringify([{ title: '' }, { reason: 'no title' }, { title: 'Kept', reason: 'ok' }])
    assert.deepEqual(parseUnmatchedPicks(raw), [
      { title: 'Kept', year: null, creator: undefined, reason: 'ok' },
    ])
  })
})
