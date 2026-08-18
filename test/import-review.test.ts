import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildReview, type CatalogEntry, type ExistingEntry, type StagedRow } from '../app/data/imports/review.ts'

let nextId = 1

function row(partial: Partial<StagedRow> = {}): StagedRow {
  const id = partial.id ?? nextId++
  return {
    id,
    rowIndex: id,
    title: 'Heat',
    year: 1995,
    rating: 4.5,
    disliked: null,
    notes: null,
    consumedAt: Date.parse('2024-03-12T00:00:00Z'),
    state: 'confident',
    reason: 'exact',
    yearDelta: 0,
    mediaItemId: 1,
    ...partial,
  }
}

function entry(id: number, title: string, releaseYear: number | null): CatalogEntry {
  return { id, title, releaseYear, creator: null, posterUrl: null }
}

function catalog(...entries: CatalogEntry[]): Map<number, CatalogEntry> {
  return new Map(entries.map((e) => [e.id, e]))
}

function logged(...entries: ExistingEntry[]): Map<number, ExistingEntry> {
  return new Map(entries.map((e) => [e.mediaItemId, e]))
}

describe('buildReview bucketing', () => {
  it('counts a clean row without asking anything of the reader', () => {
    const model = buildReview([row()], catalog(entry(1, 'Heat', 1995)), logged(), 'keep')

    assert.equal(model.confidentCount, 1)
    assert.equal(model.uncertain.length, 0)
    assert.deepEqual(model.counts, { total: 1, save: 1, unchanged: 0, leftOut: 0 })
  })

  it('puts an uncertain row in front of the reader but still saves it', () => {
    const rows = [row({ id: 1, state: 'uncertain', reason: 'year_drift', yearDelta: 29 })]
    const model = buildReview(rows, catalog(entry(1, 'The Thing', 2011)), logged(), 'keep')

    assert.equal(model.uncertain.length, 1)
    assert.equal(model.uncertain[0].chip, 'Year off by 29')
    // Save by default: doing nothing still logs it.
    assert.equal(model.counts.save, 1)
    assert.equal(model.counts.leftOut, 0)
  })

  it('leaves a not-found row out rather than guessing', () => {
    const rows = [row({ id: 1, state: 'not_found', reason: null, yearDelta: null, mediaItemId: null })]
    const model = buildReview(rows, catalog(), logged(), 'keep')

    assert.equal(model.notFound.length, 1)
    assert.deepEqual(model.counts, { total: 1, save: 0, unchanged: 0, leftOut: 1 })
  })

  it('sorts the least certain rows to the top', () => {
    const rows = [
      row({ id: 1, state: 'uncertain', reason: 'year_drift', yearDelta: 1, mediaItemId: 1 }),
      row({ id: 2, state: 'uncertain', reason: 'title_differs', yearDelta: 0, mediaItemId: 2 }),
      row({ id: 3, state: 'uncertain', reason: 'year_drift', yearDelta: 29, mediaItemId: 3 }),
    ]
    const model = buildReview(
      rows,
      catalog(entry(1, 'Kwaidan', 1965), entry(2, 'Solaris', 1972), entry(3, 'The Thing', 2011)),
      logged(),
      'keep',
    )

    assert.deepEqual(model.uncertain.map(({ row }) => row.id), [2, 3, 1])
  })

  it('counts only the off-by-one tail as bulk acceptable', () => {
    const rows = [
      row({ id: 1, state: 'uncertain', reason: 'year_drift', yearDelta: 1, mediaItemId: 1 }),
      row({ id: 2, state: 'uncertain', reason: 'year_drift', yearDelta: 29, mediaItemId: 2 }),
    ]
    const model = buildReview(rows, catalog(entry(1, 'Kwaidan', 1965), entry(2, 'The Thing', 2011)), logged(), 'keep')

    assert.equal(model.bulkAcceptable, 1)
  })
})

describe('buildReview conflicts', () => {
  const existing: ExistingEntry = {
    mediaItemId: 1,
    rating: 4.5,
    disliked: null,
    consumedAt: Date.parse('2023-03-12T00:00:00Z'),
    notes: 'still the best shootout',
  }

  it('raises a row that would overwrite a different rating', () => {
    const model = buildReview([row({ rating: 4, notes: 'still the best shootout' })], catalog(entry(1, 'Heat', 1995)), logged(existing), 'keep')

    assert.equal(model.conflicts.length, 1)
    assert.deepEqual(model.conflicts[0].fields.includes('rating'), true)
    // Kept by default, so it is neither a write nor a loss.
    assert.deepEqual(model.counts, { total: 1, save: 0, unchanged: 1, leftOut: 0 })
  })

  it('says nothing about a row that agrees with the log', () => {
    const same = row({
      rating: existing.rating,
      notes: existing.notes,
      consumedAt: existing.consumedAt,
    })
    const model = buildReview([same], catalog(entry(1, 'Heat', 1995)), logged(existing), 'keep')

    // The whole reason a re-import of an unchanged export is not 400 decisions.
    assert.equal(model.conflicts.length, 0)
    assert.equal(model.confidentCount, 1)
  })

  it('turns kept conflicts into updates when the import is taken', () => {
    const model = buildReview([row({ rating: 4, notes: existing.notes })], catalog(entry(1, 'Heat', 1995)), logged(existing), 'take')

    assert.deepEqual(model.counts, { total: 1, save: 1, unchanged: 0, leftOut: 0 })
  })

  it('honours a row taken by hand over the batch default', () => {
    // Pressing Take on one row has to mean that row, whatever the switch above
    // it says — otherwise the per-row buttons are decoration.
    const rows = [row({ state: 'confirmed', rating: 4, notes: existing.notes })]
    const model = buildReview(rows, catalog(entry(1, 'Heat', 1995)), logged(existing), 'keep')

    assert.equal(model.conflicts.length, 1)
    assert.deepEqual(model.counts, { total: 1, save: 1, unchanged: 0, leftOut: 0 })
  })

  it('counts a kept row as unchanged rather than left out', () => {
    const rows = [row({ state: 'kept', rating: 4 })]
    const model = buildReview(rows, catalog(entry(1, 'Heat', 1995)), logged(existing), 'keep')

    // Not written, but not lost either — the log already has it.
    assert.equal(model.conflicts.length, 0)
    assert.deepEqual(model.counts, { total: 1, save: 0, unchanged: 1, leftOut: 0 })
  })

  it('reports a conflict ahead of the match being uncertain', () => {
    const rows = [row({ state: 'uncertain', reason: 'year_drift', yearDelta: 1, rating: 4, notes: existing.notes })]
    const model = buildReview(rows, catalog(entry(1, 'Heat', 1995)), logged(existing), 'keep')

    assert.equal(model.conflicts.length, 1)
    assert.equal(model.uncertain.length, 0)
  })
})

describe('buildReview duplicates', () => {
  it('reads two years apart as two different films and holds the mover back', () => {
    const rows = [
      row({ id: 41, title: 'Solaris', year: 1972, state: 'confident', reason: 'exact', yearDelta: 0, mediaItemId: 7 }),
      row({ id: 288, title: 'Solaris', year: 2002, state: 'uncertain', reason: 'year_drift', yearDelta: -30, mediaItemId: 7 }),
    ]
    const model = buildReview(rows, catalog(entry(7, 'Solaris', 1972)), logged(), 'keep')

    assert.equal(model.duplicates.length, 1)
    const { verdict } = model.duplicates[0]
    assert.equal(verdict.kind, 'different_films')
    if (verdict.kind !== 'different_films') return
    assert.equal(verdict.move.id, 288)
    // Held back rather than overwriting the anchor, until someone decides.
    assert.equal(model.counts.leftOut, 1)
    assert.equal(model.counts.save, 1)
  })

  it('reads the same title and year as one film logged twice', () => {
    const rows = [
      row({ id: 12, title: 'Drive', year: 2011, consumedAt: 1_700_000_000_000, mediaItemId: 9 }),
      row({ id: 210, title: 'Drive', year: 2011, consumedAt: 1_730_000_000_000, mediaItemId: 9 }),
    ]
    const model = buildReview(rows, catalog(entry(9, 'Drive', 2011)), logged(), 'keep')

    const { verdict } = model.duplicates[0]
    assert.equal(verdict.kind, 'repeat')
    if (verdict.kind !== 'repeat') return
    assert.equal(verdict.keep.id, 210)
  })

  it('ignores a row already skipped', () => {
    const rows = [
      row({ id: 1, mediaItemId: 3 }),
      row({ id: 2, mediaItemId: 3, state: 'skipped' }),
    ]
    const model = buildReview(rows, catalog(entry(3, 'Heat', 1995)), logged(), 'keep')

    assert.equal(model.duplicates.length, 0)
    assert.equal(model.counts.leftOut, 1)
  })
})
