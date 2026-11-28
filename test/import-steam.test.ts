import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CandidateLike } from '../app/data/imports/classify.ts'
import {
  matchSteamTitle,
  planEditionMerge,
  searchVariants,
  steamRows,
  type EditionRow,
} from '../app/data/imports/steam.ts'
import type { CatalogQuery } from '../app/data/catalog/query.ts'

// The Steam rules, without the database or the network: which library entries
// are staged and as what, how a Steam name is matched, and how editions of one
// game fold together. The staging and matching around them are covered in
// import-steam-batch.test.ts.

describe('steam rows', () => {
  it('stages games by playtime and leaves the non-games out', () => {
    const rows = steamRows([
      { appId: 1, name: 'Hades', playtimeMinutes: 1200 },
      { appId: 2, name: 'Hades Original Soundtrack', playtimeMinutes: 0 },
      { appId: 3, name: 'Celeste', playtimeMinutes: 0 },
      { appId: 4, name: 'Counter-Strike Dedicated Server', playtimeMinutes: 30 },
    ])

    assert.deepEqual(
      rows.map((row) => [row.rowIndex, row.title, row.logStatus]),
      [
        [1, 'Hades', 'consumed'],
        [2, 'Celeste', 'want_to_consume'],
      ],
    )
  })

  it('carries no year, rating, date or note — Steam has none of them', () => {
    const [row] = steamRows([{ appId: 1, name: 'Hades', playtimeMinutes: 5 }])
    assert.equal(row!.year, null)
    assert.equal(row!.rating, null)
    assert.equal(row!.consumedAt, null)
    assert.equal(row!.notes, undefined)
  })
})

describe('steam search variants', () => {
  it('tries the name, then without a year, then without the edition', () => {
    assert.deepEqual(searchVariants('Painkiller: Gold Edition (2005)'), [
      'Painkiller: Gold Edition (2005)',
      'Painkiller: Gold Edition',
      'painkiller',
    ])
  })

  it('tries a plain name once', () => {
    assert.deepEqual(searchVariants('Celeste'), ['Celeste'])
  })
})

function catalog(byQuery: Record<string, CandidateLike[]>) {
  const asked: string[] = []
  const search = async (query: CatalogQuery) => {
    asked.push(query.title ?? '')
    return byQuery[query.title ?? ''] ?? []
  }
  return { asked, search }
}

const game = (externalId: string, title: string): CandidateLike => ({ externalId, title, releaseYear: null })

describe('matching a steam name', () => {
  it('takes an exact title, ignoring trademark marks and case', async () => {
    const { search } = catalog({
      "Sid Meier's Civilization® VI": [
        game('civ5', "Sid Meier's Civilization V"),
        game('civ6', "Sid Meier's Civilization VI"),
      ],
    })
    assert.equal((await matchSteamTitle("Sid Meier's Civilization® VI", search))?.externalId, 'civ6')
  })

  it('falls back to the edition-less name, searched on its own', async () => {
    const { asked, search } = catalog({
      'Painkiller: Gold Edition': [game('pk-overdose', 'Painkiller: Overdose')],
      painkiller: [game('pk', 'Painkiller')],
    })
    assert.equal((await matchSteamTitle('Painkiller: Gold Edition', search))?.externalId, 'pk')
    assert.deepEqual(asked, ['Painkiller: Gold Edition', 'painkiller'])
  })

  it('takes nothing rather than a near miss', async () => {
    const { search } = catalog({ Portal: [game('p2', 'Portal 2'), game('pk', 'Portal Knights')] })
    assert.equal(await matchSteamTitle('Portal', search), null)
  })
})

const row = (
  id: number,
  mediaItemId: number | null,
  logStatus: EditionRow['logStatus'],
  state = 'confident',
) => ({
  id,
  rowIndex: id,
  state,
  mediaItemId,
  logStatus,
})

describe('merging steam editions', () => {
  it('folds editions into the first, played if any edition was', () => {
    const merge = planEditionMerge([
      row(1, 50, 'want_to_consume'),
      row(2, 60, 'consumed'),
      row(3, 50, 'consumed'),
      row(4, 50, 'want_to_consume'),
    ])
    assert.deepEqual(merge, { restatus: [{ id: 1, logStatus: 'consumed' }], drop: [3, 4] })
  })

  it('leaves the status alone when the editions agree', () => {
    assert.deepEqual(planEditionMerge([row(1, 50, 'want_to_consume'), row(2, 50, 'want_to_consume')]), {
      restatus: [],
      drop: [2],
    })
  })

  it('keeps the row a member answered over the first listed', () => {
    const merge = planEditionMerge([row(1, 50, 'consumed'), row(2, 50, 'want_to_consume', 'confirmed')])
    assert.deepEqual(merge, { restatus: [{ id: 2, logStatus: 'consumed' }], drop: [1] })
  })

  it('never merges rows with no match, however many there are', () => {
    assert.deepEqual(
      planEditionMerge([row(1, null, 'consumed', 'not_found'), row(2, null, 'consumed', 'not_found')]),
      { restatus: [], drop: [] },
    )
  })
})
