import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { titlesLikelyMatch } from '../app/data/recommendations/matching.ts'
import { normalizeTitle, withoutSubtitle } from '../app/data/titles.ts'

// Publishers, exporters and catalogs disagree about the ampersand — a Goodreads row
// for "Fire & Blood" against a catalog "Fire and Blood" read as a different title and
// went to the review queue for a person to settle. Five copies of this rule knew
// different things; see app/data/titles.ts.
describe('normalizeTitle', () => {
  it('reads an ampersand as the word', () => {
    assert.equal(normalizeTitle('Fire & Blood'), normalizeTitle('Fire and Blood'))
    assert.equal(normalizeTitle('Head Lopper & the Island'), normalizeTitle('Head Lopper and the Island'))
    assert.equal(normalizeTitle('Ratchet & Clank'), normalizeTitle('Ratchet and Clank'))
  })

  // Punctuation is deleted rather than spaced, which is what makes these pairs — all
  // of which catalogs print both ways — the same title.
  it('deletes punctuation inside a word', () => {
    assert.equal(normalizeTitle('Spider-Man'), normalizeTitle('Spiderman'))
    assert.equal(normalizeTitle('S.W.A.T.'), normalizeTitle('SWAT'))
    assert.equal(normalizeTitle("Kushiel's Dart"), normalizeTitle('Kushiels Dart'))
    assert.equal(normalizeTitle('Kushiel\u2019s Dart'), normalizeTitle('Kushiels Dart'))
  })

  // The other side of that trade, stated rather than discovered later: a hyphen
  // standing in for a space is not levelled out here. The similarity check is what
  // catches it, at 0.8 against a 0.5 threshold.
  it('does not equate a hyphen with a space, and says who does', () => {
    assert.notEqual(normalizeTitle('WALL-E'), normalizeTitle('Wall E'))
    assert.ok(titlesLikelyMatch('WALL-E', 'Wall E'))
  })

  it('still tells different titles apart', () => {
    assert.notEqual(normalizeTitle('Fire & Blood'), normalizeTitle('Blood & Fire'))
  })
})

describe('withoutSubtitle', () => {
  it('keeps the main title and drops what follows a separator', () => {
    assert.equal(withoutSubtitle('The Night Circus: A Novel'), normalizeTitle('The Night Circus'))
    assert.equal(
      withoutSubtitle('Zen and the Art of Motorcycle Maintenance — An Inquiry'),
      normalizeTitle('Zen and the Art of Motorcycle Maintenance'),
    )
  })

  it('leaves a title with no subtitle alone', () => {
    assert.equal(withoutSubtitle('Graceling'), normalizeTitle('Graceling'))
  })

  // A prefix is not a subtitle: these are different novels.
  it('does not treat a longer title as the shorter one', () => {
    assert.notEqual(withoutSubtitle('Foundation and Empire'), normalizeTitle('Foundation'))
  })
})
