import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
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
