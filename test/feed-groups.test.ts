import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FeedItem } from '../app/data/feed.ts'
import { groupFeed, MAX_GROUP_SIZE, MIN_GROUP_SIZE, trailingRunLength } from '../app/data/feedGroups.ts'

// The rule behind the home feed's dividers: a long enough run of one person's
// rows of one kind folds into a group, and nothing else moves.

let nextId = 1

// Only the fields the grouping reads are real; the rest is filler the rule
// never looks at.
function run(owner: { id: number; label: string } | null): FeedItem {
  const id = nextId++
  return { kind: 'run', at: 1_000_000 - id, id, run: { owner } } as FeedItem
}

function log(actorId: number): FeedItem {
  const id = nextId++
  return {
    kind: 'log',
    at: 1_000_000 - id,
    id,
    entry: { actor: { id: actorId, label: `user ${actorId}` } },
  } as FeedItem
}

const times = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make)

const shape = (items: FeedItem[]) =>
  groupFeed(items).map((entry) => (entry.kind === 'group' ? `group(${entry.items.length})` : 'item'))

describe('feed groups', () => {
  it('folds a long run of your own runs into one group', () => {
    assert.deepEqual(shape(times(8, () => run(null))), ['group(8)'])
  })

  it('leaves a run shorter than the threshold alone', () => {
    assert.deepEqual(
      shape(times(MIN_GROUP_SIZE - 1, () => run(null))),
      times(MIN_GROUP_SIZE - 1, () => 'item'),
    )
  })

  it('keeps people apart, and a person’s runs apart from their logs', () => {
    const mona = { id: 7, label: 'mona' }
    const items = [
      ...times(4, () => log(7)),
      ...times(4, () => run(mona)),
      ...times(4, () => log(8)),
      ...times(4, () => run(null)),
    ]
    const groups = groupFeed(items)
    assert.deepEqual(shape(items), ['group(4)', 'group(4)', 'group(4)', 'group(4)'])
    assert.deepEqual(
      groups.map((entry) => entry.kind === 'group' && entry.key),
      ['log:7', 'run:7', 'log:8', 'run:you'],
    )
  })

  it('only groups consecutive rows, and keeps the order', () => {
    const items = [...times(2, () => log(7)), log(8), ...times(5, () => log(7)), log(8)]
    assert.deepEqual(shape(items), ['item', 'item', 'item', 'group(5)', 'item'])

    const flattened = groupFeed(items).flatMap((entry) =>
      entry.kind === 'group' ? entry.items : [entry.item],
    )
    assert.deepEqual(flattened, items)
  })

  it('splits a burst longer than the cap into several groups', () => {
    assert.deepEqual(shape(times(MAX_GROUP_SIZE + 5, () => log(7))), [`group(${MAX_GROUP_SIZE})`, 'group(5)'])
  })

  it('measures the run a page ends on', () => {
    assert.equal(trailingRunLength([]), 0)
    assert.equal(trailingRunLength([log(7), log(8), log(8), log(8)]), 3)
    assert.equal(trailingRunLength([log(8), run(null)]), 1)
  })
})
