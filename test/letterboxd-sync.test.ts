import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { foldRewatches } from '../app/data/imports/letterboxdSync.ts'
import type { LetterboxdEntry } from '../app/data/imports/letterboxdFeed.ts'

function entry(over: Partial<LetterboxdEntry> & { tmdbId: string }): LetterboxdEntry {
  return {
    title: 'A Film',
    year: 2020,
    rating: null,
    watchedAt: null,
    notes: null,
    ...over,
  }
}

// Feed order is newest first, which is what decides who wins below.
describe('foldRewatches', () => {
  it('leaves a feed with no rewatch in it alone', () => {
    const entries = [entry({ tmdbId: '1' }), entry({ tmdbId: '2' })]

    assert.deepEqual(foldRewatches(entries), entries)
  })

  it('collapses two diary entries for one film into a single row', () => {
    const folded = foldRewatches([
      entry({ tmdbId: '7', watchedAt: 200, rating: 4 }),
      entry({ tmdbId: '7', watchedAt: 100, rating: 2 }),
    ])

    // Not just deduped — the *newest* watch is the one that survives, since it
    // is what consumed_at should end up saying.
    assert.equal(folded.length, 1)
    assert.equal(folded[0]!.watchedAt, 200)
    assert.equal(folded[0]!.rating, 4)
  })

  it('keeps the review from an earlier watch the rewatch did not repeat', () => {
    const folded = foldRewatches([
      entry({ tmdbId: '7', watchedAt: 200, rating: null, notes: null }),
      entry({ tmdbId: '7', watchedAt: 100, rating: 3, notes: 'Better than I remembered.' }),
    ])

    assert.equal(folded[0]!.watchedAt, 200)
    // A rewatch logged without a word should not throw away what was written
    // the first time round.
    assert.equal(folded[0]!.notes, 'Better than I remembered.')
    assert.equal(folded[0]!.rating, 3)
  })

  it('does not edit the entries it was given', () => {
    const older = entry({ tmdbId: '7', watchedAt: 100, notes: 'A note.' })
    const newer = entry({ tmdbId: '7', watchedAt: 200, notes: null })

    foldRewatches([newer, older])

    assert.equal(newer.notes, null)
  })

  it('holds one row per film across several rewatches', () => {
    const folded = foldRewatches([
      entry({ tmdbId: '7', watchedAt: 300 }),
      entry({ tmdbId: '8', watchedAt: 250 }),
      entry({ tmdbId: '7', watchedAt: 200 }),
      entry({ tmdbId: '7', watchedAt: 100 }),
    ])

    assert.deepEqual(
      folded.map((row) => [row.tmdbId, row.watchedAt]),
      [
        ['7', 300],
        ['8', 250],
      ],
    )
  })
})
