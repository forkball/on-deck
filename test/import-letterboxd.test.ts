import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseLetterboxdExport, parseLetterboxdUpload } from '../app/data/imports/letterboxd.ts'
import { buildZip } from './support/build-zip.ts'

const RATINGS_HEADER = 'Date,Name,Year,Letterboxd URI,Rating\n'
const REVIEWS_HEADER = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n'

function ratings(...lines: string[]): string {
  return RATINGS_HEADER + lines.map((line) => `${line}\n`).join('')
}

function reviews(...lines: string[]): string {
  return REVIEWS_HEADER + lines.map((line) => `${line}\n`).join('')
}

describe('parseLetterboxdExport', () => {
  it('carries the review text onto the rated row', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5'),
      reviews: reviews('2024-03-02,Heat,1995,https://boxd.it/r,4.5,,The diner scene alone.,,2024-02-28'),
    })

    assert.equal(rows.length, 1, 'the two files describe one film, not two')
    assert.equal(rows[0].notes, 'The diner scene alone.')
    assert.equal(rows[0].rating, 4.5)
  })

  it('prefers the watched date over the date the rating was recorded', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5'),
      reviews: reviews('2024-03-02,Heat,1995,https://boxd.it/r,4.5,,Great.,,2024-02-28'),
    })

    assert.equal(rows[0].consumedAt, Date.parse('2024-02-28'))
  })

  it('keeps a film that was reviewed but never rated', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5'),
      reviews: reviews('2024-03-02,Stalker,1979,https://boxd.it/r,,,Still thinking about it.,,2024-03-02'),
    })

    assert.equal(rows.length, 2)
    const stalker = rows.find((row) => row.title === 'Stalker')
    assert.ok(stalker, 'a reviewed film with no rating still belongs in the import')
    assert.equal(stalker.notes, 'Still thinking about it.')
    assert.equal(stalker.rating, null)
  })

  it('gives a review-only row an index that cannot collide with a rated one', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings(
        '2024-03-01,Heat,1995,https://boxd.it/a,4.5',
        '2024-03-01,Sicario,2015,https://boxd.it/b,4',
      ),
      reviews: reviews('2024-03-02,Stalker,1979,https://boxd.it/r,,,Good.,,2024-03-02'),
    })

    const indexes = rows.map((row) => row.rowIndex)
    assert.equal(new Set(indexes).size, indexes.length, 'row numbers tell duplicate rows apart')
  })

  it('ignores a diary row that carries no review text', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5'),
      reviews: reviews('2024-03-02,Heat,1995,https://boxd.it/r,4.5,,,,2024-02-28'),
    })

    assert.equal(rows[0].notes, null, 'a blank Review cell must not clear a note written by hand')
  })

  it('matches across the punctuation the two files disagree on', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,WALL·E,2008,https://boxd.it/a,5'),
      reviews: reviews('2024-03-02,WALL-E,2008,https://boxd.it/r,5,,Perfect.,,2024-02-28'),
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].notes, 'Perfect.')
  })

  it('does not merge two films that share a title but not a year', () => {
    const rows = parseLetterboxdExport({
      ratings: ratings('2024-03-01,Solaris,1972,https://boxd.it/a,5'),
      reviews: reviews('2024-03-02,Solaris,2002,https://boxd.it/r,3,,The remake.,,2024-02-28'),
    })

    assert.equal(rows.length, 2)
  })

  it('takes the rating from a review when ratings.csv has none for it', () => {
    const rows = parseLetterboxdExport({
      reviews: reviews('2024-03-02,Heat,1995,https://boxd.it/r,4.5,,Great.,,2024-02-28'),
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].rating, 4.5)
    assert.equal(rows[0].notes, 'Great.')
  })

  it('survives an export with no reviews.csv in it at all', () => {
    const rows = parseLetterboxdExport({ ratings: ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5') })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].notes, null)
  })

  it('keeps a multi-line review intact', () => {
    const rows = parseLetterboxdExport({
      reviews: reviews('2024-03-02,Heat,1995,https://boxd.it/r,5,,"One line.\n\nAnother line.",,2024-02-28'),
    })

    assert.equal(rows[0].notes, 'One line.\n\nAnother line.')
  })
})

describe('parseLetterboxdUpload', () => {
  const RATINGS = ratings('2024-03-01,Heat,1995,https://boxd.it/a,4.5')
  const REVIEWS = reviews('2024-03-02,Stalker,1979,https://boxd.it/r,,,Good.,,2024-03-02')

  it('reads both files out of an export zip', () => {
    const upload = parseLetterboxdUpload(
      buildZip([
        { name: 'letterboxd-erik-2026-08-19/ratings.csv', body: RATINGS },
        { name: 'letterboxd-erik-2026-08-19/reviews.csv', body: REVIEWS },
      ]),
    )

    assert.equal(upload.rows.length, 2)
    assert.equal(upload.reviewsOnly, false)
  })

  it('flags a zip that someone assembled without ratings.csv', () => {
    const upload = parseLetterboxdUpload(buildZip([{ name: 'reviews.csv', body: REVIEWS }]))

    assert.equal(upload.reviewsOnly, true, 'this is only the films they wrote about')
    assert.equal(upload.rows.length, 1)
  })

  it('does not flag a zip carrying ratings but no reviews', () => {
    const upload = parseLetterboxdUpload(buildZip([{ name: 'ratings.csv', body: RATINGS }]))
    assert.equal(upload.reviewsOnly, false, 'never having written a review is not a partial export')
  })

  it('refuses a zip with neither file in it', () => {
    assert.throws(
      () => parseLetterboxdUpload(buildZip([{ name: 'watchlist.csv', body: 'Name\nHeat\n' }])),
      /no ratings.csv or reviews.csv/,
    )
  })

  it('refuses a loose ratings.csv, which would silently drop every review', () => {
    assert.throws(
      () => parseLetterboxdUpload(new Uint8Array(Buffer.from(RATINGS, 'utf8'))),
      /single file rather than the export archive/,
    )
  })

  it('refuses a loose reviews.csv too', () => {
    assert.throws(
      () => parseLetterboxdUpload(new Uint8Array(Buffer.from(REVIEWS, 'utf8'))),
      /single file rather than the export archive/,
    )
  })
})
