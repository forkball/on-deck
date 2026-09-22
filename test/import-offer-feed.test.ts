import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { offersFeed } from '../app/actions/profile/imports/controller.tsx'
import type { ImportBatch, User } from '../app/data/schema.ts'

// The two halves of Letterboxd support are independent — an export is history,
// the feed is what comes next — and a member has to choose both. This is the
// moment to ask for the second, and the rule for when asking makes sense.
function batch(over: Partial<ImportBatch> = {}): ImportBatch {
  return { status: 'done', source: 'letterboxd', media_type: 'movie', ...over } as ImportBatch
}

function member(over: Partial<User> = {}): User {
  return { letterboxd_username: null, is_admin: true, ...over } as User
}

describe('offering the feed after an import', () => {
  it('asks once a Letterboxd film import is saved', () => {
    assert.equal(offersFeed(batch(), member()), true)
  })

  // Mid-review there is nothing to keep up to date yet, and the page is busy
  // asking about matches.
  it('waits until the batch is actually saved', () => {
    assert.equal(offersFeed(batch({ status: 'review' }), member()), false)
    assert.equal(offersFeed(batch({ status: 'matching' }), member()), false)
  })

  it('says nothing to someone already following their diary', () => {
    assert.equal(offersFeed(batch(), member({ letterboxd_username: 'someone' })), false)
  })

  // Goodreads and Steam have their own importers and no feed behind them, so
  // finishing one must not offer a Letterboxd connection.
  it('does not follow a book or game import', () => {
    assert.equal(offersFeed(batch({ media_type: 'book', source: 'goodreads' }), member()), false)
    assert.equal(offersFeed(batch({ media_type: 'game', source: 'steam' }), member()), false)
  })

  // Both halves of the pair have to hold: the right source and the right type.
  it('does not offer for a film import from somewhere else', () => {
    assert.equal(offersFeed(batch({ source: 'imdb' }), member()), false)
  })

  // The gate covers the whole feature, offers included — asking someone to
  // connect something they cannot use would be worse than silence.
  it('stays quiet while the feed sync is gated off', () => {
    const original = process.env.LETTERBOXD_FEED_SYNC
    delete process.env.LETTERBOXD_FEED_SYNC
    try {
      assert.equal(offersFeed(batch(), member({ is_admin: false })), false)
      // An admin has it either way, which is what the beta runs on.
      assert.equal(offersFeed(batch(), member({ is_admin: true })), true)
    } finally {
      if (original === undefined) delete process.env.LETTERBOXD_FEED_SYNC
      else process.env.LETTERBOXD_FEED_SYNC = original
    }
  })
})
