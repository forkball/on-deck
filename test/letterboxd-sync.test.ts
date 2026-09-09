import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  coverageWatermark,
  foldRewatches,
  selectRemovable,
  type SyncedRow,
} from '../app/data/imports/letterboxdSync.ts'
import type { LetterboxdEntry } from '../app/data/imports/letterboxdFeed.ts'

function entry(over: Partial<LetterboxdEntry> & { tmdbId: string }): LetterboxdEntry {
  return {
    title: 'A Film',
    year: 2020,
    rating: null,
    watchedAt: null,
    publishedAt: null,
    notes: null,
    ...over,
  }
}

function row(over: Partial<SyncedRow> & { tmdbId: string | null }): SyncedRow {
  return {
    interactionId: 1,
    title: 'A Film',
    sourceEntryAt: null,
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

  // The newest publication date has to survive the fold, or a rewatch would age
  // its own row out of the feed's window while the feed is still carrying it —
  // and a row outside the window is one deletion can never reach.
  it('keeps the newest publication date across a rewatch', () => {
    const folded = foldRewatches([
      entry({ tmdbId: '7', publishedAt: 900 }),
      entry({ tmdbId: '7', publishedAt: 100 }),
    ])

    assert.equal(folded[0]!.publishedAt, 900)
  })
})

describe('coverageWatermark', () => {
  it('is the oldest entry the feed is still showing', () => {
    const watermark = coverageWatermark([
      entry({ tmdbId: '1', publishedAt: 500 }),
      entry({ tmdbId: '2', publishedAt: 200 }),
      entry({ tmdbId: '3', publishedAt: 900 }),
    ])

    assert.equal(watermark, 200)
  })

  // An empty feed is the case a naive diff reads as "everything was deleted".
  it('refuses to answer for an empty feed', () => {
    assert.equal(coverageWatermark([]), null)
  })

  it('refuses to answer when nothing in the feed carries a date', () => {
    assert.equal(coverageWatermark([entry({ tmdbId: '1' }), entry({ tmdbId: '2' })]), null)
  })
})

// The four refusals are the feature. Each of these is a way the naive version
// of this — "logged here, absent from the feed, so delete it" — destroys
// something it shouldn't.
describe('selectRemovable', () => {
  const feed = [entry({ tmdbId: 'kept', publishedAt: 1_000 }), entry({ tmdbId: 'also-kept', publishedAt: 2_000 })]

  it('takes a row the feed stopped carrying from inside its window', () => {
    const removable = selectRemovable(feed, [row({ tmdbId: 'gone', sourceEntryAt: 1_500, interactionId: 42 })])

    assert.deepEqual(
      removable.map((r) => r.interactionId),
      [42],
    )
  })

  it('leaves a row the feed is still carrying', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'kept', sourceEntryAt: 1_000 })]), [])
  })

  // The truncation guard. The feed holds a bounded number of recent entries, so
  // a film published before the oldest one shown is out of view rather than
  // gone — this is the whole back catalogue, and the reason a watermark exists.
  it('leaves a row published before the window opens', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'ancient', sourceEntryAt: 400 })]), [])
  })

  // Rows written before source_entry_at existed. They cannot be placed against
  // the window at all, so they are never eligible.
  it('leaves a row with no entry date', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'undated', sourceEntryAt: null })]), [])
  })

  it('leaves the row sitting exactly on the watermark', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'boundary', sourceEntryAt: 1_000 })]), [])
  })

  it('leaves a row whose catalog entry has no external id to compare', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: null, sourceEntryAt: 1_500 })]), [])
  })

  // Belt and braces with coverageWatermark: an empty feed must not be read as
  // "the member deleted their entire diary".
  it('takes nothing at all when the feed is empty', () => {
    assert.deepEqual(selectRemovable([], [row({ tmdbId: 'gone', sourceEntryAt: 1_500 })]), [])
  })

  it('separates the gone from the kept in one pass', () => {
    const removable = selectRemovable(feed, [
      row({ tmdbId: 'kept', sourceEntryAt: 1_000, interactionId: 1 }),
      row({ tmdbId: 'gone', sourceEntryAt: 1_500, interactionId: 2 }),
      row({ tmdbId: 'ancient', sourceEntryAt: 10, interactionId: 3 }),
      row({ tmdbId: 'also-gone', sourceEntryAt: 3_000, interactionId: 4 }),
    ])

    assert.deepEqual(
      removable.map((r) => r.interactionId),
      [2, 4],
    )
  })
})
