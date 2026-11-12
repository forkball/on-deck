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
// Database-free, like titles.ts, so the rule is tested directly.

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
  const words = normalizeTitle(creator ?? '').split(' ').filter(Boolean)
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
  hasCover: boolean
  // Whether the person searching has this exact row in their log. The card that
  // shows their status is the one to keep, or their entry disappears from search.
  logged: boolean
}

// One result per book, in the place of that book's best-ranked edition. The one
// kept is the edition they logged, else one with a cover, else the best-ranked.
export function collapseEditions<T>(results: T[], describe: (result: T) => EditionFacts): T[] {
  const facts = results.map(describe)
  const keys = facts.map((fact) => editionKey(fact.title, fact.creator))

  const best = new Map<string, number>()
  keys.forEach((key, index) => {
    if (!key) return
    const held = best.get(key)
    if (held === undefined || outranks(facts[index]!, facts[held]!)) best.set(key, index)
  })

  const placed = new Set<string>()
  const kept: T[] = []
  keys.forEach((key, index) => {
    if (!key) {
      kept.push(results[index]!)
      return
    }
    if (placed.has(key)) return
    placed.add(key)
    kept.push(results[best.get(key)!]!)
  })
  return kept
}

// Strictly better only, so a tie leaves the earlier — better-ranked — edition held.
function outranks(candidate: EditionFacts, held: EditionFacts): boolean {
  if (candidate.logged !== held.logged) return candidate.logged
  if (candidate.hasCover !== held.hasCover) return candidate.hasCover
  return false
}
