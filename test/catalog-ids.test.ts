import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fieldedBookQuery, plainBookQuery } from '../app/data/catalog/googleBooks.ts'
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

// Google Books is the one catalog that can be asked a precise question, and asking
// it a vague one is what fills the table with study guides: "Iron Flame Rebecca
// Yarros" is free text over titles, descriptions and blurbs alike, so a summary of
// the novel outranks the novel.
describe('fieldedBookQuery', () => {
  it('confines the title and the author to their own fields', () => {
    assert.equal(
      fieldedBookQuery({ title: 'Iron Flame', creator: 'Rebecca Yarros' }),
      'intitle:"Iron Flame" inauthor:"Rebecca Yarros"',
    )
  })

  it('still qualifies the title when nobody is named', () => {
    assert.equal(fieldedBookQuery({ title: 'Iron Flame' }), 'intitle:"Iron Flame"')
    assert.equal(fieldedBookQuery({ title: 'Iron Flame', creator: null }), 'intitle:"Iron Flame"')
    assert.equal(fieldedBookQuery({ title: 'Iron Flame', creator: '  ' }), 'intitle:"Iron Flame"')
  })

  // An unbalanced quote is the failure this guards: it would close the phrase early
  // and hand the rest of the title back to free text, which is what we are escaping.
  it('drops a quote inside a title rather than leaving the phrase open', () => {
    assert.equal(fieldedBookQuery({ title: 'The "Genius" Myth' }), 'intitle:"The  Genius  Myth"')
  })

  // A search box is not a title field: `intitle:"yarros"` finds nothing, and someone
  // typing an author, a series or half a title has to find something.
  it('qualifies nothing when the words are only what a person typed', () => {
    assert.equal(fieldedBookQuery({ text: 'yarros' }), null)
    assert.equal(plainBookQuery({ text: 'yarros' }), 'yarros')
  })

  // An isbn identifies the volume outright, so there is nothing left to qualify.
  it('asks by isbn when there is one, and nothing else', () => {
    assert.equal(
      fieldedBookQuery({ title: 'Iron Flame', creator: 'Rebecca Yarros', isbn: '9781649374172' }),
      'isbn:9781649374172',
    )
  })
})

// What the qualified query falls back to when it finds nothing, and the only form
// Open Library understands — it has no qualifiers, and would search for the words.
describe('plainBookQuery', () => {
  it('runs the title and the author together', () => {
    assert.equal(
      plainBookQuery({ title: 'Iron Flame', creator: 'Rebecca Yarros' }),
      'Iron Flame Rebecca Yarros',
    )
  })

  it('takes a missing or blank creator as no creator', () => {
    assert.equal(plainBookQuery({ title: 'Iron Flame' }), 'Iron Flame')
    assert.equal(plainBookQuery({ title: 'Iron Flame', creator: null }), 'Iron Flame')
    assert.equal(plainBookQuery({ title: 'Iron Flame', creator: '  ' }), 'Iron Flame')
  })

  // The one qualifier Open Library does read, which is why the importer could get
  // away with composing it by hand for as long as it did.
  it('keeps an isbn lookup as an isbn lookup', () => {
    assert.equal(plainBookQuery({ title: 'Iron Flame', isbn: '9781649374172' }), 'isbn:9781649374172')
  })
})
