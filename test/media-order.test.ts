import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ACTIVE_MEDIA_TYPES, parseMediaOrder, serializeMediaOrder } from '../app/mediaTypes.ts'

describe('parseMediaOrder', () => {
  it('is the registry order when nothing was chosen', () => {
    assert.deepEqual(parseMediaOrder(null), [...ACTIVE_MEDIA_TYPES])
    assert.deepEqual(parseMediaOrder(''), [...ACTIVE_MEDIA_TYPES])
  })

  it('keeps a full order as given', () => {
    assert.deepEqual(parseMediaOrder('game,book,tv,movie'), ['game', 'book', 'tv', 'movie'])
  })

  it('appends the types an order leaves out, in registry order', () => {
    // A saved order from before a type existed must not hide its tab.
    assert.deepEqual(parseMediaOrder('book,tv'), ['book', 'tv', 'movie', 'game'])
  })

  it('drops unknown and repeated entries', () => {
    assert.deepEqual(parseMediaOrder('podcast, game ,game,movie'), ['game', 'movie', 'tv', 'book'])
  })
})

describe('serializeMediaOrder', () => {
  it('stores a chosen order', () => {
    assert.equal(serializeMediaOrder(['book', 'movie', 'tv', 'game']), 'book,movie,tv,game')
  })

  it('stores nothing for the registry order', () => {
    assert.equal(serializeMediaOrder([...ACTIVE_MEDIA_TYPES]), null)
    assert.equal(serializeMediaOrder([]), null)
  })
})
