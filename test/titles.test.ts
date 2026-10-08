import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { titlesLikelyMatch } from '../app/data/recommendations/matching.ts'
import {
  normalizeName,
  normalizeTitle,
  withoutSubtitle,
  titleWordsFitInside,
  sameWorkKey,
  titlesNameSameWork,
} from '../app/data/titles.ts'

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

// The rule the Open Library → Google Books backfill repoints a row on. It is stricter
// than the matcher's, because the row is shared by everyone who logged the book: a
// false match writes the wrong book into other people's histories, where a missed one
// only leaves the row where it already was.
describe('titlesNameSameWork', () => {
  it('takes the same words in a different order', () => {
    // Which is how two catalogs disagree about where a series name belongs. This pair
    // scored 0.44 under the character-distance rule this replaced, and was rejected.
    assert.equal(titlesNameSameWork('House Corrino: Dune', 'Dune: House Corrino'), true)
    assert.equal(
      titlesNameSameWork('Twelfth Night, or What You Will', 'Twelfth Night: Or, What You Will'),
      true,
    )
  })

  it('refuses two different novels that share their words around', () => {
    // The failure this exists for. Scored 0.52 on shared letters and was accepted,
    // which would have repointed a logged row onto a different book in the series.
    assert.equal(titlesNameSameWork('Dune House Corrino', 'Dune: The Battle of Corrin'), false)
    assert.equal(titlesNameSameWork("Hunter's Moon & Other American Gothic Tales", 'Hunters of Dune'), false)
  })

  it('reads an ampersand the way the rest of the app does', () => {
    assert.equal(titlesNameSameWork('Fire & Blood', 'Fire and Blood'), true)
  })

  // A subtitle is not settled here on purpose — see titleWordsFitInside.
  it('does not accept a title merely for sitting inside another', () => {
    assert.equal(titlesNameSameWork('The Goldfinch', 'The Goldfinch: A Novel'), false)
    assert.equal(titlesNameSameWork('Dune', 'Dune: House Harkonnen'), false)
  })
})

describe('titleWordsFitInside', () => {
  it('sees a title inside a longer one', () => {
    assert.equal(titleWordsFitInside('The Goldfinch', 'The Goldfinch: A Novel'), true)
    assert.equal(titleWordsFitInside('Macbeth', 'Macbeth (Annotated)'), true)
    assert.equal(titleWordsFitInside('Age of Dinosaurs', 'The Age of Dinosaurs: The Rise and Fall'), true)
  })

  // The reason this is not sufficient on its own, stated as a test: these two pairs
  // are indistinguishable by their words, and one is a subtitle while the other is a
  // different novel by a different author.
  it('cannot tell a subtitle from a sequel, which is why the author decides', () => {
    assert.equal(titleWordsFitInside('Dune', 'Dune: House Harkonnen'), true)
    assert.equal(titleWordsFitInside('The Goldfinch', 'The Goldfinch: A Novel'), true)
  })

  it('is one-directional', () => {
    assert.equal(titleWordsFitInside('Macbeth (Annotated)', 'Macbeth'), false)
  })

  it('refuses a title that only overlaps', () => {
    assert.equal(titleWordsFitInside('Dune House Corrino', 'Dune: The Battle of Corrin'), false)
  })
})

// Catalogs disagree about accents constantly, and the two sides of a comparison come
// from different ones by definition: a stored row from Open Library against a result
// from Google Books.
describe('accents', () => {
  // The failure this fixes. Stripping anything outside a-z turned "Brontë" into
  // "bront", which matches nothing spelled "Bronte", so the backfill skipped the clean
  // 418-page Wuthering Heights at the top of its results and took a 100-page record
  // that happened to carry the diaeresis too.
  it('reads a name past its accents', () => {
    assert.equal(normalizeName('Emily Brontë'), normalizeName('Emily Bronte'))
    assert.equal(normalizeName('Gabriel García Márquez'), normalizeName('Gabriel Garcia Marquez'))
  })

  // NFD separates a letter from its mark, which is no help for the letters that are
  // not a base plus a mark but characters of their own.
  it('reads the letters NFD cannot take apart', () => {
    assert.equal(normalizeName('Jo Nesbø'), normalizeName('Jo Nesbo'))
    assert.equal(normalizeName('Søren Kierkegaard'), normalizeName('Soren Kierkegaard'))
    assert.equal(normalizeTitle('Æon Flux'), normalizeTitle('Aeon Flux'))
  })

  it('folds a title the same way', () => {
    assert.equal(
      normalizeTitle('À la recherche du temps perdu'),
      normalizeTitle('A la recherche du temps perdu'),
    )
    assert.equal(normalizeTitle('Mémoires'), normalizeTitle('Memoires'))
  })

  // The rules folding runs alongside, which it must not disturb.
  it('leaves the ampersand and the punctuation rules alone', () => {
    assert.equal(normalizeTitle('Fire & Blood'), normalizeTitle('Fire and Blood'))
    assert.equal(normalizeTitle('Spider-Man'), normalizeTitle('Spiderman'))
  })
})

// The key has to say "same work" exactly when titlesNameSameWork does, since lists
// checked by key stand in for comparing every pair.
describe('sameWorkKey', () => {
  const pairs: [string, string][] = [
    ['House Corrino: Dune', 'Dune: House Corrino'],
    ['Twelfth Night, or What You Will', 'Twelfth Night: Or, What You Will'],
    ['Fire & Blood', 'Fire and Blood'],
    ['Dune', 'Dune: House Corrino'],
    ['Brontë', 'Bronte'],
    ['The The', 'The'],
    ['', ''],
    ['!!!', '???'],
  ]

  it('agrees with titlesNameSameWork', () => {
    for (const [a, b] of pairs) {
      const byKey = sameWorkKey(a) !== '' && sameWorkKey(a) === sameWorkKey(b)
      assert.equal(byKey, titlesNameSameWork(a, b), `${a} / ${b}`)
    }
  })
})
