import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { looksReal } from '../app/data/catalog/openLibrary.ts'

// Open Library's index is open, so it carries everything anyone has ever catalogued
// next to the book someone actually wants. Three signals sort that out, and each was
// added for results seen in a real search.
const doc = (title: string, extra: { subtitle?: string; cover?: boolean } = {}) => ({
  key: '/works/OL1W',
  title,
  subtitle: extra.subtitle,
  cover_i: extra.cover === false ? undefined : 1,
})

describe('looksReal', () => {
  it('keeps a book', () => {
    assert.equal(looksReal(doc('Fourth Wing')), true)
    assert.equal(looksReal(doc('The Hobbit')), true)
  })

  // Real books have ~94% cover coverage; the self-published summaries that shadow a
  // popular title almost never do, which is what makes this worth a filter at all.
  it('drops anything with no cover', () => {
    assert.equal(looksReal(doc('Project Hail Mary: A Novel', { cover: false })), false)
  })

  it('drops a study aid that does have one', () => {
    assert.equal(looksReal(doc("Summary of Andy Weir's Project Hail Mary")), false)
    assert.equal(looksReal(doc('Study Guide -- The Other Wes Moore by Wes Moore')), false)
  })

  // Sold with the book, and not the book. A set has no single year, author or page
  // count for the app to be right about.
  it('drops a box set or something to colour in', () => {
    assert.equal(looksReal(doc('Empyrean Series, 3 Books Collection Set, Fourth Wing, Iron Flame')), false)
    assert.equal(looksReal(doc('The Hobbit & The Lord of the Rings [collection/set]')), false)
    assert.equal(looksReal(doc('Harry Potter Deluxe Coloring Book')), false)
    assert.equal(looksReal(doc('The Hobbit. An Unexpected Journey. Activity Book')), false)
  })

  // Open Library splits a title across two fields inconsistently, so the whole thing
  // has to be read: this one is "Fourth Wing" with the rest in the subtitle.
  it('reads the subtitle too', () => {
    assert.equal(looksReal(doc('Fourth Wing', { subtitle: 'The Official Coloring Book' })), false)
  })

  // Deliberately kept. These are books people read and log, and a filter that cannot
  // tell them from an activity book has no business guessing.
  it('keeps a companion, which is a real book', () => {
    assert.equal(looksReal(doc('The Hobbit companion')), true)
    assert.equal(looksReal(doc('A Dune Companion')), true)
  })
})
