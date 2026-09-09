import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  isLetterboxdSyncEnabled,
  letterboxdSyncAvailableTo,
  letterboxdFeedUrl,
  normalizeLetterboxdUsername,
  parseLetterboxdFeed,
} from '../app/data/imports/letterboxdFeed.ts'

// A recorded feed rather than a hand-written one, trimmed to four entries: a
// review, a rated watch, an unrated watch, and one of the lists Letterboxd
// mixes into the same feed. Nothing here touches the network.
const FIXTURE = readFileSync(new URL('./support/letterboxd-feed.xml', import.meta.url), 'utf8')

describe('parseLetterboxdFeed', () => {
  it('reads a diary entry off the recorded feed', () => {
    const [entry] = parseLetterboxdFeed(FIXTURE)

    assert.equal(entry!.tmdbId, '891621')
    assert.equal(entry!.title, 'Wild Horse Nine')
    assert.equal(entry!.year, 2026)
    assert.equal(entry!.rating, 3)
    assert.equal(entry!.watchedAt, Date.parse('2026-09-03'))
  })

  // Two different dates, and the gap between them is the point: this entry was
  // published to the diary on the 4th for a film watched on the 3rd. Backdating
  // stretches that gap arbitrarily, which is why only pubDate can be used to
  // reason about what the feed still covers.
  it('reads the publication date apart from the watched date', () => {
    const [entry] = parseLetterboxdFeed(FIXTURE)

    assert.equal(entry!.publishedAt, Date.parse('Fri, 4 Sep 2026 05:33:38 +1200'))
    assert.notEqual(entry!.publishedAt, entry!.watchedAt)
  })

  it('drops the lists Letterboxd puts in the same feed', () => {
    const entries = parseLetterboxdFeed(FIXTURE)

    // The fixture holds four items and one of them is a list, which has no film
    // attached to it at all.
    assert.equal(entries.length, 3)
    assert.ok(entries.every((entry) => entry.tmdbId !== ''))
  })

  it('carries review text across as a note, without the poster', () => {
    const [review] = parseLetterboxdFeed(FIXTURE)

    assert.ok(review!.notes)
    assert.match(review!.notes, /^Another melancholically splenetic Martin McDonagh jag/)
    // The description opens with the poster image and is HTML throughout.
    assert.doesNotMatch(review!.notes, /<img|<p>|<\/p>/)
    // Paragraph breaks are the one piece of structure worth keeping.
    assert.match(review!.notes, /\n\n/)
  })

  it('takes no note from a plain watch, whose description is boilerplate', () => {
    const [, watched] = parseLetterboxdFeed(FIXTURE)

    assert.equal(watched!.title, 'Is God Is')
    // "Watched on Saturday August 22, 2026." is Letterboxd talking, not the
    // member — logging it as a note would fill the log with junk.
    assert.equal(watched!.notes, null)
  })

  it('reports an unrated watch as unrated rather than zero', () => {
    const [, , unrated] = parseLetterboxdFeed(FIXTURE)

    assert.equal(unrated!.title, 'Girl with a Suitcase')
    assert.equal(unrated!.rating, null)
    assert.equal(unrated!.watchedAt, Date.parse('2026-08-11'))
  })

  it('decodes entities in titles', () => {
    const entries = parseLetterboxdFeed(`<rss><channel>
      <item>
        <guid isPermaLink="false">letterboxd-watch-1</guid>
        <letterboxd:filmTitle>Sex, Lies &amp; Videotape &#8212; Director&#39;s Cut</letterboxd:filmTitle>
        <letterboxd:filmYear>1989</letterboxd:filmYear>
        <letterboxd:watchedDate>2026-01-02</letterboxd:watchedDate>
        <tmdb:movieId>1234</tmdb:movieId>
      </item>
    </channel></rss>`)

    assert.equal(entries[0]!.title, "Sex, Lies & Videotape — Director's Cut")
  })

  it('ignores an entry with no film id, whatever its guid says', () => {
    const entries = parseLetterboxdFeed(`<rss><channel>
      <item>
        <guid isPermaLink="false">letterboxd-watch-2</guid>
        <letterboxd:filmTitle>Untracked</letterboxd:filmTitle>
        <letterboxd:watchedDate>2026-01-02</letterboxd:watchedDate>
      </item>
    </channel></rss>`)

    assert.deepEqual(entries, [])
  })
})

describe('normalizeLetterboxdUsername', () => {
  it('accepts a member name and lowercases it', () => {
    assert.equal(normalizeLetterboxdUsername('  DavidEhrlich '), 'davidehrlich')
    assert.equal(normalizeLetterboxdUsername('some_one99'), 'some_one99')
  })

  it('rejects anything that could steer the request elsewhere', () => {
    for (const input of ['', 'has space', '../admin', 'a/b', 'https://letterboxd.com/x', 'x'.repeat(33)]) {
      assert.equal(normalizeLetterboxdUsername(input), null, input)
    }
  })

  it('builds the feed url from the member name', () => {
    assert.equal(letterboxdFeedUrl('davidehrlich'), 'https://letterboxd.com/davidehrlich/rss/')
  })
})

const original = process.env.LETTERBOXD_FEED_SYNC

function withFlag<T>(value: string | undefined, read: () => T): T {
  if (value === undefined) delete process.env.LETTERBOXD_FEED_SYNC
  else process.env.LETTERBOXD_FEED_SYNC = value
  try {
    return read()
  } finally {
    if (original === undefined) delete process.env.LETTERBOXD_FEED_SYNC
    else process.env.LETTERBOXD_FEED_SYNC = original
  }
}

// The only switch the RSS feature has, and it covers removals as well as
// writes — so "off when nothing is set" is also what keeps a forgotten
// variable from deleting anyone's rows.
describe('isLetterboxdSyncEnabled', () => {
  function flagged(value: string | undefined): boolean {
    return withFlag(value, isLetterboxdSyncEnabled)
  }

  it('is off when nothing is set, so a forgotten variable ships nothing', () => {
    assert.equal(flagged(undefined), false)
    assert.equal(flagged(''), false)
  })

  it('is on for the values someone switching it on would write', () => {
    for (const value of ['1', 'true', 'TRUE', ' true ']) {
      assert.equal(flagged(value), true, value)
    }
  })

  it('stays off for values that read as "no"', () => {
    // The trap this avoids: treating any non-empty string as on would make
    // LETTERBOXD_FEED_SYNC=0 enable the feature.
    for (const value of ['0', 'false', 'no', 'off']) {
      assert.equal(flagged(value), false, value)
    }
  })
})

describe('letterboxdSyncAvailableTo', () => {
  const member = { is_admin: false }
  const admin = { is_admin: true }

  it('is closed to an ordinary member while the flag is unset', () => {
    assert.equal(withFlag(undefined, () => letterboxdSyncAvailableTo(member)), false)
  })

  it('is open to an admin even then, which is what makes a production beta possible', () => {
    assert.equal(withFlag(undefined, () => letterboxdSyncAvailableTo(admin)), true)
  })

  it('is open to everyone once the flag is set', () => {
    assert.equal(withFlag('1', () => letterboxdSyncAvailableTo(member)), true)
    assert.equal(withFlag('1', () => letterboxdSyncAvailableTo(admin)), true)
  })
})
