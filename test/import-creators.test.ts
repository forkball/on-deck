import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CandidateLike } from '../app/data/imports/classify.ts'
import { addCreators } from '../app/data/imports/matcher.ts'

const film = (externalId: string, releaseYear: number): CandidateLike => ({
  externalId,
  title: 'Little Women',
  releaseYear,
})

describe('addCreators', () => {
  it('looks up who made each namesake, once per film, only where there is a choice', async () => {
    const asked: string[] = []
    const directors: Record<string, string> = { a: 'Gillian Armstrong', b: 'Greta Gerwig' }
    const provider = {
      async getById(externalId: string) {
        asked.push(externalId)
        if (externalId === 'c') throw new Error('catalog down')
        return {
          externalId,
          title: 'Little Women',
          releaseYear: null,
          creator: directors[externalId] ?? null,
        } as never
      },
    }

    const pair = [film('a', 1994), film('b', 2019)]
    const again = [film('b', 2019), film('c', 1933)]
    const sole = [film('d', 1949)]
    await addCreators(provider, [pair, again, sole, null])

    assert.deepEqual(asked.sort(), ['a', 'b', 'c'])
    assert.deepEqual(
      pair.map((candidate) => candidate.creator),
      ['Gillian Armstrong', 'Greta Gerwig'],
    )
    assert.equal(again[0]!.creator, 'Greta Gerwig')
    // A failed lookup leaves the year on its own.
    assert.equal(again[1]!.creator, undefined)
    assert.equal(sole[0]!.creator, undefined)
  })
})
