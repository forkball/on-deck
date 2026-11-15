// Which search results are editions of one book, so the search page can show one
// card for it rather than one per printing.
//
// Google Books ids a volume, not a work: each printing, ebook and regional release
// is its own result, and a search for "Baltimore Plague Ships" answered with three
// of them — "Baltimore Volume I: The Plague Ships" by Mike Mignola (2011),
// "Baltimore: The Plague Ships" by Michael Mignola (2012), and the 2011 one again
// under a second id. Each became its own media_items row, a person's log sits on
// whichever one they picked, and the others read as books they haven't logged.
//
// Nothing here touches those rows — they are shared, and merging them is
// rematchMediaItem's job. This only decides what one results page shows.
//
// Single issues of a comic are a second, related problem, handled at the bottom.
//
// Database-free, like titles.ts, so the rules are tested directly.

import { normalizeTitle, sameWorkKey } from '../titles.ts'

// A first volume is printed both with and without saying so. Only the first:
// "Saga Volume 2" keeps its 2 and stays apart from Volume 1. Matched on the
// normalized title, where "Vol. I" has already become "vol i".
const FIRST_VOLUME = /\b(?:volume|vol|book)\s+(?:1|i|one)\b/g

// Publisher filler that names no part of the work.
const FILLER = /\ba novel\b/g

// Why not titleWordsFitInside: "Dune" fits inside "Dune Messiah", same author, a
// different novel. Dropping only words that name no other book keeps that apart.
export function editionTitleKey(title: string): string {
  return sameWorkKey(normalizeTitle(title).replace(FIRST_VOLUME, ' ').replace(FILLER, ' '))
}

const NAME_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

// Surname only: the same author is "Mike Mignola" on one printing and "Michael
// Mignola" on the next, and "J.R.R. Tolkien" against "J. R. R. Tolkien".
export function authorSurnameKey(creator: string | null | undefined): string {
  const words = normalizeTitle(creator ?? '')
    .split(' ')
    .filter(Boolean)
  while (words.length > 1 && NAME_SUFFIX.has(words[words.length - 1]!)) words.pop()
  return words[words.length - 1] ?? ''
}

// Empty when either half is missing: with no author, two same-titled books are as
// likely to be different works as editions of one, and a card wrongly hidden is
// worse than one shown twice.
export function editionKey(title: string, creator: string | null | undefined): string {
  const titleKey = editionTitleKey(title)
  const surname = authorSurnameKey(creator)
  return titleKey && surname ? `${surname}|${titleKey}` : ''
}

export interface EditionFacts {
  title: string
  creator: string | null
  // Every credited name where the catalog gives them, the first included. An
  // anthology's printings each put a different contributor first — Creepshow
  // Volume 1 came back as Chris Burnham's, Paul Dini's and "AA.VV."'s — so the
  // first name alone kept three printings of one book apart.
  creators?: string[]
  hasCover: boolean
  // Whether the person searching has this exact row in their log. The card that
  // shows their status is the one to keep, or their entry disappears from search.
  logged: boolean
}

function surnamesOf(fact: EditionFacts): Set<string> {
  const names = fact.creators?.length ? fact.creators : [fact.creator]
  return new Set(names.map(authorSurnameKey).filter(Boolean))
}

// One result per book, in the place of that book's best-ranked edition. The one
// kept is the edition they logged, else one with a cover, else the best-ranked.
//
// Two results are one book when their titles match (editionTitleKey) and their
// credits share a surname — any surname, not only the first: that is what still
// tells "Batman Volume 1" by Snyder from "Batman Volume 1" by King, which share
// a title and no one. Shared through a third counts too, so three printings that
// each overlap the next are one book.
export function collapseEditions<T>(results: T[], describe: (result: T) => EditionFacts): T[] {
  const facts = results.map(describe)
  const titleKeys = facts.map((fact) => editionTitleKey(fact.title))
  const surnames = facts.map(surnamesOf)

  // Union-find over indexes; each group's root is its best-ranked member.
  const parent = facts.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  for (let a = 0; a < facts.length; a++) {
    if (!titleKeys[a] || surnames[a]!.size === 0) continue
    for (let b = a + 1; b < facts.length; b++) {
      if (titleKeys[b] !== titleKeys[a]) continue
      if (![...surnames[b]!].some((name) => surnames[a]!.has(name))) continue
      const [ra, rb] = [find(a), find(b)]
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    }
  }

  const best = new Map<number, number>()
  facts.forEach((fact, index) => {
    const root = find(index)
    const held = best.get(root)
    if (held === undefined || outranks(fact, facts[held]!)) best.set(root, index)
  })

  const kept: T[] = []
  facts.forEach((_, index) => {
    if (find(index) === index) kept.push(results[best.get(index)!]!)
  })
  return kept
}

// Strictly better only, so a tie leaves the earlier — better-ranked — edition held.
function outranks(candidate: EditionFacts, held: EditionFacts): boolean {
  if (candidate.logged !== held.logged) return candidate.logged
  if (candidate.hasCover !== held.hasCover) return candidate.hasCover
  return false
}

// Single issues of a comic, gathered into one entry per series.
//
// Unlike printings these are separate works — #1 and #3 are different chapters —
// so they are never collapsed into one. But Google Books files each issue as a
// volume in its own right, their titles match a search for the series almost word
// for word, and five of them crowd the collected book down the page. So the page
// shows them as one entry that opens to list them.

// "Baltimore: The Plague Ships #3", "… Issue 3", "… #3 (of 5)". Trailing only:
// a number elsewhere in a title is part of the name.
const ISSUE_SUFFIX = /^(.*?\S)\s*(?:#\s*|\bissue\s+)(\d+)(?:\s*\(\s*of\s+\d+\s*\))?\s*$/i

export interface ParsedIssue {
  series: string
  number: number
}

export function parseIssue(title: string): ParsedIssue | null {
  const match = ISSUE_SUFFIX.exec(title.trim())
  if (!match) return null
  const series = match[1]!.replace(/[\s:,–—-]+$/, '')
  return series ? { series, number: Number(match[2]) } : null
}

// A result, with the single issues it collects when they came back too; or a
// series' issues with no collected edition among the results to sit under.
export type SearchEntry<T> =
  | { kind: 'single'; result: T; issues?: T[] }
  | { kind: 'issues'; series: string; issues: T[] }

export interface IssueFacts {
  title: string
  // Whether the catalog files it as a comic — the "graphic novel" tag, which a
  // Google Books search hit carries from its top-level "Comics & Graphic Novels"
  // category.
  comic: boolean
}

// Only results tagged as comics count as issues. The title pattern alone also fits
// numbered novel series — "Goosebumps #1", "Animorphs #2", "The Boxcar Children
// #3" — which are separate books a person searching for one wants to see, and
// which the page would mislabel as "single issues". A comic hit Google filed with
// no category at all is missed, and shows as an ordinary result: the safe way to
// be wrong.
//
// Grouped by the series title alone, not the author: one series' issues credit
// whichever writer Google picked first, Golden on one and Mignola on the next.
//
// Where the collected edition came back too — "Baltimore Volume I: The Plague
// Ships" for issues of "Baltimore: The Plague Ships", the same title once the
// volume marker is dropped — the issues go under it, since that book is them
// bound together, and it sits where the better-ranked of the two did. A lone issue
// joins its volume the same way. Otherwise two or more issues are an entry of
// their own; a lone one stays an ordinary result, since a group of one hides
// nothing. Issues are listed in number order.
export function groupSingleIssues<T>(results: T[], describe: (result: T) => IssueFacts): SearchEntry<T>[] {
  const facts = results.map(describe)
  const parsed = facts.map(({ title, comic }) => (comic ? parseIssue(title) : null))
  const keys = parsed.map((issue) => (issue ? editionTitleKey(issue.series) : ''))

  const members = new Map<string, number[]>()
  keys.forEach((key, index) => {
    if (key) members.set(key, [...(members.get(key) ?? []), index])
  })

  // The first comic that isn't itself an issue and names the same work.
  const collectedBy = new Map<string, number>()
  facts.forEach(({ title, comic }, index) => {
    if (!comic || parsed[index]) return
    const key = editionTitleKey(title)
    if (members.has(key) && !collectedBy.has(key)) collectedBy.set(key, index)
  })
  const collects = new Map([...collectedBy].map(([key, index]) => [index, key]))

  const inNumberOrder = (key: string) =>
    // Stable, so two printings of one issue keep their rank order.
    [...members.get(key)!].sort((a, b) => parsed[a]!.number - parsed[b]!.number).map((m) => results[m]!)

  const placed = new Set<string>()
  const entries: SearchEntry<T>[] = []
  results.forEach((result, index) => {
    const key = keys[index] || collects.get(index) || ''
    const collected = key ? collectedBy.get(key) : undefined
    const group = key ? members.get(key)! : []

    if (collected === undefined && group.length < 2) {
      entries.push({ kind: 'single', result })
      return
    }
    if (placed.has(key)) return
    placed.add(key)
    entries.push(
      collected === undefined
        ? { kind: 'issues', series: parsed[index]!.series, issues: inNumberOrder(key) }
        : { kind: 'single', result: results[collected]!, issues: inNumberOrder(key) },
    )
  })
  return entries
}
