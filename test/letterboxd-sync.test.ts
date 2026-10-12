import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  coverageFrom,
  feedCoverage,
  foldRewatches,
  selectRemovable,
  sinceConnected,
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

// A fetch on its own can say how far back it reaches. It takes the one before
// it to say why that line moved.
describe('feedCoverage', () => {
  const feed = [
    entry({ tmdbId: '1', publishedAt: 500 }),
    entry({ tmdbId: '2', publishedAt: 200 }),
    entry({ tmdbId: '3', publishedAt: 900 }),
  ]

  it('is the oldest entry the feed is still showing', () => {
    assert.deepEqual(feedCoverage(feed), { at: 200, inclusive: false })
  })

  // An empty feed is the case a naive diff reads as "everything was deleted".
  it('refuses to answer for an empty feed', () => {
    assert.equal(feedCoverage([]), null)
  })

  it('refuses to answer when nothing in the feed carries a date', () => {
    assert.equal(feedCoverage([entry({ tmdbId: '1' }), entry({ tmdbId: '2' })]), null)
  })

  // The bug this exists for. A feed that lost items with nothing refilling it
  // was not truncated, so it still answers for where it reached last time —
  // including for the entry that *was* that floor, hence inclusive.
  it('reaches back to the old floor when the feed shrank', () => {
    const coverage = feedCoverage(feed, { floor: 100, items: 4 })

    assert.deepEqual(coverage, { at: 100, inclusive: true })
  })

  // A full feed that truncates keeps its entry count, so a count that held —
  // or grew — is the case the widening must not touch. Three entries here,
  // against three and two seen last time.
  it('stays where it is when the feed did not shrink', () => {
    assert.deepEqual(feedCoverage(feed, { floor: 100, items: 3 }), { at: 200, inclusive: false })
    assert.deepEqual(feedCoverage(feed, { floor: 100, items: 2 }), { at: 200, inclusive: false })
  })

  // Lists share the feed but live in their own block with their own cap, so
  // they can neither push a diary entry out nor stand in for one. Counting raw
  // <item>s read a deleted list as a diary that had shrunk, and widened the
  // window onto rows that were only truncated — deleting films still sitting on
  // Letterboxd. Only the entries are counted, so the lists cannot reach this.
  it('counts diary entries rather than everything in the feed', () => {
    const withLists = [...feed]

    assert.deepEqual(feedCoverage(withLists, { floor: 100, items: 3 }), { at: 200, inclusive: false })
  })

  // A feed can lose an entry and backfill in the same interval. The lower of
  // the two floors is the one both fetches can vouch for.
  it('takes the lower floor when the feed both shrank and backfilled', () => {
    assert.deepEqual(feedCoverage(feed, { floor: 300, items: 4 }), { at: 200, inclusive: true })
  })

  // Nothing to compare against on a first sync, or on a row written before the
  // columns existed.
  it('has only this fetch to go on the first time', () => {
    assert.deepEqual(feedCoverage(feed, { floor: null, items: null }), { at: 200, inclusive: false })
    assert.deepEqual(feedCoverage(feed, { floor: 100, items: null }), { at: 200, inclusive: false })
  })

  // A feed missing most of its items is a short response or a change at
  // Letterboxd, not someone tidying a diary — and trusting it would delete rows
  // that are still there.
  it('refuses to widen for a collapse rather than a shrink', () => {
    assert.deepEqual(feedCoverage(feed, { floor: 100, items: 40 }), { at: 200, inclusive: false })
  })
})

// The four refusals are the feature. Each of these is a way the naive version
// of this — "logged here, absent from the feed, so delete it" — destroys
// something it shouldn't.
describe('selectRemovable', () => {
  const feed = [
    entry({ tmdbId: 'kept', publishedAt: 1_000 }),
    entry({ tmdbId: 'also-kept', publishedAt: 2_000 }),
  ]
  // What this feed says for itself, with no previous fetch to widen it.
  const window = feedCoverage(feed)

  it('takes a row the feed stopped carrying from inside its window', () => {
    const removable = selectRemovable(
      feed,
      [row({ tmdbId: 'gone', sourceEntryAt: 1_500, interactionId: 42 })],
      window,
    )

    assert.deepEqual(
      removable.map((r) => r.interactionId),
      [42],
    )
  })

  it('leaves a row the feed is still carrying', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'kept', sourceEntryAt: 1_000 })], window), [])
  })

  // The truncation guard. The feed holds a bounded number of recent entries, so
  // a film published before the oldest one shown is out of view rather than
  // gone — this is the whole back catalogue, and the reason a watermark exists.
  it('leaves a row published before the window opens', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'ancient', sourceEntryAt: 400 })], window), [])
  })

  // Rows written before source_entry_at existed. They cannot be placed against
  // the window at all, so they are never eligible.
  it('leaves a row with no entry date', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'undated', sourceEntryAt: null })], window), [])
  })

  it('leaves the row sitting exactly on the watermark', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: 'boundary', sourceEntryAt: 1_000 })], window), [])
  })

  it('leaves a row whose catalog entry has no external id to compare', () => {
    assert.deepEqual(selectRemovable(feed, [row({ tmdbId: null, sourceEntryAt: 1_500 })], window), [])
  })

  // Belt and braces with coverageWatermark: an empty feed must not be read as
  // "the member deleted their entire diary".
  it('takes nothing at all when the feed is empty', () => {
    assert.deepEqual(
      selectRemovable([], [row({ tmdbId: 'gone', sourceEntryAt: 1_500 })], feedCoverage([])),
      [],
    )
  })

  it('separates the gone from the kept in one pass', () => {
    const removable = selectRemovable(
      feed,
      [
        row({ tmdbId: 'kept', sourceEntryAt: 1_000, interactionId: 1 }),
        row({ tmdbId: 'gone', sourceEntryAt: 1_500, interactionId: 2 }),
        row({ tmdbId: 'ancient', sourceEntryAt: 10, interactionId: 3 }),
        row({ tmdbId: 'also-gone', sourceEntryAt: 3_000, interactionId: 4 }),
      ],
      window,
    )

    assert.deepEqual(
      removable.map((r) => r.interactionId),
      [2, 4],
    )
  })
})

// The gap the coverage line closes, at the level of the rule: with the feed
// known to have shrunk, the row sitting exactly on the old floor is the one
// that went.
describe('selectRemovable at the bottom of the window', () => {
  const before = [
    entry({ tmdbId: 'newest', publishedAt: 3_000 }),
    entry({ tmdbId: 'middle', publishedAt: 2_000 }),
    entry({ tmdbId: 'oldest', publishedAt: 1_000 }),
  ]
  const after = before.slice(0, 2)
  const rows = [row({ tmdbId: 'oldest', sourceEntryAt: 1_000, interactionId: 7 })]

  it('was refused when only the new feed could be consulted', () => {
    assert.deepEqual(selectRemovable(after, rows, feedCoverage(after)), [])
  })

  it('is taken once the previous fetch says the feed shrank', () => {
    const coverage = feedCoverage(after, { floor: 1_000, items: 3 })

    assert.deepEqual(
      selectRemovable(after, rows, coverage).map((r) => r.interactionId),
      [7],
    )
  })

  // The back catalogue is still out of reach: shrinking says where the window
  // reached, not that it reached further than it ever did.
  it('still leaves what was never in view', () => {
    const coverage = feedCoverage(after, { floor: 1_000, items: 3 })

    assert.deepEqual(selectRemovable(after, [row({ tmdbId: 'ancient', sourceEntryAt: 400 })], coverage), [])
  })
})

// Connecting is a subscription, not an import: the fifty entries the feed
// happens to hold are an arbitrary slice of a library, and taking them made a
// fragment look like the whole.
describe('sinceConnected', () => {
  const feed = [
    entry({ tmdbId: 'after', publishedAt: 3_000 }),
    entry({ tmdbId: 'on', publishedAt: 2_000 }),
    entry({ tmdbId: 'before', publishedAt: 1_000 }),
  ]

  it('takes only what was written after the connection', () => {
    assert.deepEqual(
      sinceConnected(feed, 2_000).map((e) => e.tmdbId),
      ['after'],
    )
  })

  // Not a boundary worth agonising over, but it has to be one of the two: the
  // entry published in the same instant as the connection predates the decision
  // to follow it.
  it('leaves the entry sitting on the connection point', () => {
    assert.equal(
      sinceConnected(feed, 2_000).some((e) => e.tmdbId === 'on'),
      false,
    )
  })

  // A film watched in 2019 and logged today is a new diary entry. pubDate is
  // when it was written, so backdating the watch cannot hide it.
  it('follows a new entry for an old film', () => {
    const backdated = entry({ tmdbId: 'catch-up', publishedAt: 5_000, watchedAt: 1 })

    assert.deepEqual(sinceConnected([backdated], 2_000), [backdated])
  })

  it('drops an entry it cannot place against the connection', () => {
    assert.deepEqual(sinceConnected([entry({ tmdbId: 'undated' })], 2_000), [])
  })

  // Anyone who connected before this rule existed. Narrowing their window now
  // would strand the rows they already have outside everything that maintains
  // them.
  it('leaves a feed alone when there is no connection point', () => {
    assert.deepEqual(sinceConnected(feed, null), feed)
  })
})

describe('coverageFrom', () => {
  const mine = [entry({ tmdbId: 'mine', publishedAt: 3_000 })]
  const theirs = entry({ tmdbId: 'older', publishedAt: 1_000 })
  const previous = { floor: null, items: null }

  // While the feed still shows something from before the connection, it reaches
  // past everything this member can own — so nothing of theirs can have been
  // truncated, and the connection point is the floor.
  it('reaches to the connection point while the feed still predates it', () => {
    assert.deepEqual(coverageFrom([...mine, theirs], mine, 2_000, previous), { at: 2_000, inclusive: false })
  })

  // Once the window is all theirs it can truncate again, so the ordinary rule
  // takes back over.
  it("falls back to the feed's own floor once the window is all theirs", () => {
    assert.deepEqual(coverageFrom(mine, mine, 2_000, previous), { at: 3_000, inclusive: false })
  })

  it('answers for nothing when the member has logged nothing yet', () => {
    assert.equal(coverageFrom([theirs], [], 2_000, previous), null)
  })

  it('is the ordinary rule for a member with no connection point', () => {
    assert.deepEqual(coverageFrom(mine, mine, null, previous), { at: 3_000, inclusive: false })
  })
})
