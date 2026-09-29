import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { catalogSearchQuery } from '../app/data/catalog/provider.ts'
import { parseGoogleBooksId } from '../app/data/catalog/googleBooks.ts'

// What someone actually pastes. Google has changed this URL shape at least once,
// and the parser only knew the old one — so a link copied out of the address bar
// today was answered with "check the link", about a link that was correct.
describe('parseGoogleBooksId', () => {
  it('reads the form Google serves now, id last in the path', () => {
    assert.equal(
      parseGoogleBooksId('https://www.google.ca/books/edition/Iron_Flame/xIS9EAAAQBAJ?hl=en&gbpv=0'),
      'xIS9EAAAQBAJ',
    )
  })

  it('reads it with no title slug, which is what a share link often has', () => {
    assert.equal(parseGoogleBooksId('https://www.google.com/books/edition/_/xIS9EAAAQBAJ'), 'xIS9EAAAQBAJ')
  })

  it('reads a slug carrying punctuation or another script', () => {
    assert.equal(
      parseGoogleBooksId('https://www.google.com/books/edition/Kushiel%E2%80%99s_Dart/abcDEF12345'),
      'abcDEF12345',
    )
    assert.equal(
      parseGoogleBooksId('https://www.google.co.jp/books/edition/こころ/zzYY9900112'),
      'zzYY9900112',
    )
  })

  it('still reads the older query form, which old links and Play still use', () => {
    assert.equal(parseGoogleBooksId('https://books.google.com/books?id=xIS9EAAAQBAJ'), 'xIS9EAAAQBAJ')
    assert.equal(
      parseGoogleBooksId('https://play.google.com/store/books/details?id=xIS9EAAAQBAJ&hl=en'),
      'xIS9EAAAQBAJ',
    )
  })

  it('still takes a bare id', () => {
    assert.equal(parseGoogleBooksId('xIS9EAAAQBAJ'), 'xIS9EAAAQBAJ')
    assert.equal(parseGoogleBooksId('  xIS9EAAAQBAJ  '), 'xIS9EAAAQBAJ')
  })

  it('refuses what carries no id', () => {
    assert.equal(parseGoogleBooksId('https://www.google.com/books/edition/Iron_Flame'), null)
    assert.equal(parseGoogleBooksId('Iron Flame'), null)
    assert.equal(parseGoogleBooksId(''), null)
  })
})

// Shared by the recommendation pipeline and the CSV importers, which ask the same
// catalogs the same question and used to disagree about how.
describe('catalogSearchQuery', () => {
  it('names the author for a catalog whose search reads one', () => {
    assert.equal(catalogSearchQuery('book', 'Iron Flame', 'Rebecca Yarros'), 'Iron Flame Rebecca Yarros')
  })

  it('leaves titles alone for catalogs that match titles', () => {
    assert.equal(catalogSearchQuery('movie', 'Dune', 'Denis Villeneuve'), 'Dune')
    assert.equal(catalogSearchQuery('game', 'Portal 2', 'Valve'), 'Portal 2')
  })

  it('takes a missing or blank creator as no creator', () => {
    assert.equal(catalogSearchQuery('book', 'Iron Flame'), 'Iron Flame')
    assert.equal(catalogSearchQuery('book', 'Iron Flame', null), 'Iron Flame')
    assert.equal(catalogSearchQuery('book', 'Iron Flame', '  '), 'Iron Flame')
  })
})
