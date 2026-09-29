import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildPicksPrompt, type RecommendationFilters } from '../app/data/recommendations/picks.ts'

const profile = {
  label: 'Reader',
  summary: 'Likes comics and dark fantasy.',
  liked_tags: ['comics'],
  disliked_tags: [],
}

const promptFor = (filters: RecommendationFilters, mediaType: 'book' | 'movie' | 'game' = 'book') =>
  buildPicksPrompt([profile], { seen: [], rejected: [] }, filters, mediaType, [mediaType]).content

// Every lever the form can set, spelled as a Required type on purpose: adding one to
// RecommendationFilters without adding it here stops this file compiling, and the
// case below then makes someone say what the prompt should tell the model about it.
// Nothing checked any of this before — the prompt was assembled inside the request,
// so a lever that never reached the text looked exactly like a model ignoring it.
const everyLever: Required<Omit<RecommendationFilters, 'decadeRelation'>> = {
  genre: 'horror',
  decade: 1980,
  length: 'short',
  playerType: 'multiplayer',
  multiplayerType: 'coop',
  platform: 'PlayStation',
  series: 'series',
  seenBy: 'any',
}

// What each lever has to put in front of the model. seenBy is the odd one: 'no_one'
// narrows by *removing* titles from the excluded list rather than by adding a
// sentence, so the sentence only exists for 'any', which widens.
const expected: Record<keyof typeof everyLever, RegExp> = {
  genre: /"horror" genre/,
  decade: /originally released in the 1980s/,
  length: /fewer than 250 pages/,
  playerType: /playable multiplayer/,
  multiplayerType: /co-op multiplayer mode/,
  platform: /playable on PlayStation/,
  series: /part of a series/,
  seenBy: /already seen/,
}

describe('buildPicksPrompt', () => {
  for (const key of Object.keys(everyLever) as (keyof typeof everyLever)[]) {
    it(`carries the ${key} lever into the prompt`, () => {
      const prompt = promptFor({ [key]: everyLever[key] } as RecommendationFilters)

      assert.match(prompt, expected[key])
    })
  }

  it('carries all of them at once', () => {
    const prompt = promptFor(everyLever as RecommendationFilters)

    for (const pattern of Object.values(expected)) assert.match(prompt, pattern)
  })

  it('says nothing about a lever nobody set', () => {
    const prompt = promptFor({})

    for (const pattern of Object.values(expected)) assert.doesNotMatch(prompt, pattern)
  })

  // The two levers a catalog can answer say so, because a model that knows the pick
  // will be discarded picks differently — this is what turned a romance run from
  // fantasy-with-romance into romance.
  it('tells the model which levers are checked against the catalog', () => {
    assert.match(promptFor({ genre: 'horror' }), /This one is checked/)
    assert.match(promptFor({ length: 'short' }), /checked against the catalog/)
  })

  it('resolves the decade relation each way', () => {
    assert.match(promptFor({ decade: 1980, decadeRelation: 'before' }), /released before 1980/)
    assert.match(promptFor({ decade: 1980, decadeRelation: 'after' }), /released after 1989/)
  })

  it('asks for a series name, and for one entry per series unless standalone was asked for', () => {
    assert.match(promptFor({}), /Set "series_name" on each pick/)
    assert.match(promptFor({}), /at most one book per series/)
    assert.doesNotMatch(promptFor({ series: 'standalone' }), /at most one book per series/)
  })

  // Asked for only where a catalog's search reads it.
  it('asks for the author on the medium whose search needs one, and not otherwise', () => {
    assert.match(promptFor({}, 'book'), /Set "creator" on each pick/)
    assert.doesNotMatch(promptFor({}, 'movie'), /Set "creator" on each pick/)
  })

  it('over-requests when a lever narrows, since the gates drop some', () => {
    const plain = buildPicksPrompt([profile], { seen: [], rejected: [] }, {}, 'book', ['book'])
    const filtered = buildPicksPrompt([profile], { seen: [], rejected: [] }, { genre: 'horror' }, 'book', [
      'book',
    ])

    assert.ok(filtered.requestedCount > plain.requestedCount)
    assert.match(filtered.content, new RegExp(`Suggest ${filtered.requestedCount} real books`))
  })

  it('names the medium in its own words', () => {
    assert.match(promptFor({ playerType: 'multiplayer' }, 'game'), /Only suggest games playable multiplayer/)
    assert.match(promptFor({}, 'movie'), /real movies/)
  })
})
