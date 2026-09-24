import type { FeedItem } from './feed.ts'

// How many consecutive rows of one kind by one person it takes before the feed
// folds them behind a divider. Below this a run of rows reads fine as it is;
// at it, one person's burst — a batch of generated runs, a library import —
// starts pushing everyone else off the screen.
export const MIN_GROUP_SIZE = 4

// The most rows one group will hold. A group has to arrive whole, so a page
// is extended past its limit to finish one (see loadFeedPage's callers); this
// is what bounds that. A burst longer than this — a whole library imported at
// once — becomes several groups one after another, which still reads fine.
export const MAX_GROUP_SIZE = 50

// One thing the feed renders: a row on its own, or a run of rows folded behind
// a divider. `key` is the grouping key the rows share — see groupKeyOf.
export type FeedEntry = { kind: 'item'; item: FeedItem } | { kind: 'group'; key: string; items: FeedItem[] }

// What makes two rows "the same activity" for grouping: the same kind of row,
// by the same person. Kind as well as person, because "mona logged" and "mona
// generated" are different sentences and folding them together would leave the
// divider with nothing true to say about what is behind it.
//
// Your own runs are keyed apart from everyone else's by the absence of an owner
// — see RecommendationRunSummary — since the viewer has no id on the row.
export function groupKeyOf(item: FeedItem): string {
  if (item.kind === 'log') return `log:${item.entry.actor.id}`
  return item.run.owner ? `run:${item.run.owner.id}` : 'run:you'
}

// Folds each run of MIN_GROUP_SIZE or more consecutive same-key rows into a
// group, leaving everything else as it was. Order is kept: the feed is already
// newest-first, and a group sits where its newest row would have.
//
// Consecutive only — two of mona's imports an hour apart with a friend's log in
// between are two groups, because the divider stands in for rows at that point
// in the timeline and can't reach around what happened between them.
export function groupFeed(items: FeedItem[]): FeedEntry[] {
  const entries: FeedEntry[] = []
  let start = 0

  while (start < items.length) {
    const key = groupKeyOf(items[start])
    let end = start + 1
    while (end < items.length && end - start < MAX_GROUP_SIZE && groupKeyOf(items[end]) === key) end++

    const run = items.slice(start, end)
    if (run.length >= MIN_GROUP_SIZE) entries.push({ kind: 'group', key, items: run })
    else for (const item of run) entries.push({ kind: 'item', item })

    start = end
  }

  return entries
}

// How many rows at the end of `items` share the last row's key — the part of
// the page a following page could still be continuing.
export function trailingRunLength(items: FeedItem[]): number {
  if (items.length === 0) return 0
  const key = groupKeyOf(items[items.length - 1])
  let count = 0
  for (let i = items.length - 1; i >= 0 && groupKeyOf(items[i]) === key; i--) count++
  return count
}
