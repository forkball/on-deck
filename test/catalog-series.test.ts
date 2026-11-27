import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { SERIES_SOURCE, seriesExternalId, upsertSeriesItem } from '../app/data/catalog/series.ts'
import { db, pool } from '../app/data/db.ts'
import { parseMediaMetadata } from '../app/data/mediaMetadata.ts'
import type { MediaItem } from '../app/data/schema.ts'
import { skipWithoutDatabase } from './support/db.ts'

describe('series external id', () => {
  it('is the series as the issue grouping keys it', () => {
    // A store's year tag and a first-volume marker name no different series.
    assert.equal(seriesExternalId('The Last Halloween (2024-)'), seriesExternalId('The Last Halloween'))
    assert.notEqual(seriesExternalId('Animal Pound'), seriesExternalId('Animal Farm'))
  })
})

// A series' issues with no collected edition among a search's results get a row
// of their own, so the series can be logged.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('series rows', { skip: skipWithoutDatabase }, () => {
  // In the title, because the row is keyed on it: a development database holds
  // real ones, and a fixture named after a real series would be that row.
  const series = `Animal Pound zz${Date.now().toString(36)}`
  const made: number[] = []

  after(async () => {
    await pool.query('delete from media_items where id = any($1)', [made])
  })

  const issue = (number: number, metadata: Record<string, unknown>) =>
    ({
      id: -number,
      type: 'book',
      external_source: 'google-books',
      external_id: `issue-${number}`,
      title: `${series} #${number}`,
      metadata,
    }) as MediaItem

  it('makes one row a series, filled in from its issues', async () => {
    const item = await upsertSeriesItem(db, series, [
      issue(1, { releaseYear: 2023, creator: 'Tom King', creators: ['Tom King', 'Peter Gorham'] }),
      issue(2, { releaseYear: 2024, creator: 'Tom King', posterUrl: 'https://covers.test/2.jpg' }),
    ])
    made.push(item.id)

    assert.equal(item.type, 'book')
    assert.equal(item.external_source, SERIES_SOURCE)
    assert.equal(item.title, series)
    const metadata = parseMediaMetadata(item.metadata)
    assert.equal(metadata.releaseYear, 2023)
    assert.equal(metadata.creator, 'Tom King')
    assert.deepEqual(metadata.creators, ['Tom King', 'Peter Gorham'])
    // The first issue's cover there is, in the number order it was handed.
    assert.equal(metadata.posterUrl, 'https://covers.test/2.jpg')
    // What titles count a comic by.
    assert.deepEqual(metadata.tags, ['graphic novel'])
  })

  it('is the same row on the next search, whichever issues it turns up', async () => {
    const again = await upsertSeriesItem(db, `${series} (2023-)`, [
      issue(3, { releaseYear: 2024, posterUrl: 'https://covers.test/3.jpg' }),
    ])
    made.push(again.id)

    assert.equal(again.id, made[0])
    const metadata = parseMediaMetadata(again.metadata)
    // Kept from before: this search came back without #1 and #2.
    assert.equal(metadata.creator, 'Tom King')
    assert.equal(metadata.releaseYear, 2023)
    assert.equal(metadata.posterUrl, 'https://covers.test/3.jpg')
  })
})
