import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { nothingLeftMessage } from '../app/data/recommendations/generate.ts'

// A run that comes back with nothing is never saved, so this line is the whole of
// what the person gets. It has to name the control they'd go and change.
describe('nothingLeftMessage', () => {
  it('names the one filter that was set', () => {
    assert.equal(
      nothingLeftMessage({ genre: 'romance' }, 'book'),
      'No books made it through the genre filter. Try widening it and generating again.',
    )
  })

  it('lists several, in the order the form offers them', () => {
    assert.equal(
      nothingLeftMessage({ genre: 'horror', decade: 1970, length: 'short' }, 'movie'),
      'No movies made it through the genre, decade and length filters. Try widening them and generating again.',
    )
  })

  it('covers the game-only levers, which a media-type-blind list would miss', () => {
    assert.match(nothingLeftMessage({ platform: 'PlayStation' }, 'game'), /platform filter/)
    assert.match(nothingLeftMessage({ multiplayerType: 'coop' }, 'game'), /multiplayer type filter/)
  })

  it('names the already-seen lever only when it narrowed the run', () => {
    assert.match(nothingLeftMessage({ seenBy: 'no_one' }, 'movie'), /already-seen filter/)
    assert.match(nothingLeftMessage({ seenBy: 'any' }, 'movie'), /confirm this time/)
  })

  it('says something true when no filter was set at all', () => {
    assert.match(nothingLeftMessage({}, 'book'), /confirm this time/)
  })

  // decade 0 would be falsy; the levers are read for presence, not truthiness.
  it('counts a zero decade as set', () => {
    assert.match(nothingLeftMessage({ decade: 0 }, 'movie'), /decade filter/)
  })
})
