import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseGoodreadsLibrary } from '../app/data/imports/goodreads.ts'

const HEADER =
  'Title,Author,ISBN,ISBN13,My Rating,Average Rating,Publisher,Year Published,Original Publication Year,Date Read,Exclusive Shelf,My Review\n'

function shelf(...lines: string[]): string {
  return HEADER + lines.map((line) => `${line}\n`).join('')
}

const DUNE = 'Dune,Frank Herbert,="0441013597",="9780441013593",5,4.25,Ace,2005,1965,2024/02/11,read,"Still the best."'

describe('parseGoodreadsLibrary', () => {
  it('reads a shelf row whole', () => {
    const [row] = parseGoodreadsLibrary(shelf(DUNE))

    assert.equal(row.title, 'Dune')
    assert.equal(row.author, 'Frank Herbert')
    assert.equal(row.rating, 5)
    assert.equal(row.notes, 'Still the best.')
    assert.equal(row.logStatus, 'consumed')
    assert.equal(row.consumedAt, Date.parse('2024/02/11'))
  })

  it('unwraps the ISBN13 Goodreads quotes for Excel', () => {
    const [row] = parseGoodreadsLibrary(shelf(DUNE))
    assert.equal(row.isbn, '9780441013593')
  })

  it('takes the original publication year, not the year this printing came out', () => {
    const [row] = parseGoodreadsLibrary(shelf(DUNE))
    assert.equal(row.year, 1965, 'a 2005 reprint of a 1965 novel is still a 1965 novel')
  })

  it('carries a to-read shelf across as wanting to read it', () => {
    const [row] = parseGoodreadsLibrary(
      shelf('Ubik,Philip K. Dick,="",="",0,4.1,Vintage,1991,1969,,to-read,'),
    )

    assert.equal(row.logStatus, 'want_to_consume')
    assert.equal(row.rating, null, '0 is unrated, not a zero-star review')
    assert.equal(row.consumedAt, null)
  })

  it('carries a currently-reading shelf across as in progress', () => {
    const [row] = parseGoodreadsLibrary(
      shelf('Ubik,Philip K. Dick,="",="",0,4.1,Vintage,1991,1969,,currently-reading,'),
    )

    assert.equal(row.logStatus, 'in_progress')
  })

  it('drops a row on a shelf it cannot read rather than guessing at it', () => {
    const rows = parseGoodreadsLibrary(
      shelf('Ubik,Philip K. Dick,="",="",0,4.1,Vintage,1991,1969,,some-custom-shelf,'),
    )

    assert.equal(rows.length, 0, 'guessing would write an unread book into the log as finished')
  })

  it('says nothing rather than empty when there is no review', () => {
    const [row] = parseGoodreadsLibrary(
      shelf('Ubik,Philip K. Dick,="",="",4,4.1,Vintage,1991,1969,2024/01/01,read,'),
    )

    assert.equal(row.notes, null, 'an empty cell must not clear a note written by hand')
  })

  it('answers null for an ISBN the export left blank', () => {
    const [row] = parseGoodreadsLibrary(
      shelf('Ubik,Philip K. Dick,="",="",4,4.1,Vintage,1991,1969,2024/01/01,read,'),
    )

    assert.equal(row.isbn, null)
  })

  it('refuses a CSV that is not a Goodreads export', () => {
    assert.throws(() => parseGoodreadsLibrary('Date,Name,Year,Rating\n2024-01-01,Heat,1995,4\n'), /Goodreads export/)
  })

  it('numbers rows by their line in the file', () => {
    const rows = parseGoodreadsLibrary(
      shelf(DUNE, 'Ubik,Philip K. Dick,="",="",4,4.1,Vintage,1991,1969,2024/01/01,read,'),
    )

    assert.deepEqual(rows.map((row) => row.rowIndex), [2, 3])
  })
})
