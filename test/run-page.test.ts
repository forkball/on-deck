import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeParams } from '../app/actions/recommendations/run-page.tsx'
import type { GenerationParams } from '../app/data/recommendations/runs.ts'

const params = (overrides: Partial<GenerationParams>): GenerationParams =>
  ({ sourceTypes: ['book'], ...overrides }) as GenerationParams

const lineFor = (label: string, given: Partial<GenerationParams>, mediaType: 'book' | 'movie') =>
  describeParams(params(given), mediaType).find((line) => line.text.startsWith(label))

// The point of the note is that a lever answered by the model doesn't read as one
// the catalog confirmed. Which levers those are is a property worth pinning: it is
// invisible on the page when it's wrong, which is how it went unnoticed before.
describe('describeParams', () => {
  it('marks a book decade as the model\'s answer', () => {
    const line = lineFor('Decade', { decade: 1960 }, 'book')
    assert.equal(line?.text, 'Decade: 1960s')
    assert.match(line?.modelNote ?? '', /Google Books dates editions/)
  })

  it('leaves a movie decade unmarked, since the catalog answers it', () => {
    assert.equal(lineFor('Decade', { decade: 1960 }, 'movie')?.modelNote, undefined)
  })

  it('marks the series lever, which no catalog can answer', () => {
    const line = lineFor('Series', { series: 'series' }, 'book')
    assert.equal(line?.text, 'Series: Part of a series')
    assert.match(line?.modelNote ?? '', /No catalogue the app reads records/)
  })

  it('leaves the catalog-checked levers unmarked', () => {
    assert.equal(lineFor('Genre', { genre: 'horror' }, 'book')?.modelNote, undefined)
    assert.equal(lineFor('Length', { length: 'short' }, 'book')?.modelNote, undefined)
    assert.equal(lineFor('Based on', {}, 'book')?.modelNote, undefined)
  })
})
