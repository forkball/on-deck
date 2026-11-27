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

// How a book is packaged rather than which book it is. A search for The Long
// Halloween came back as "Batman: The Long Halloween", "Batman Noir: The Long
// Halloween" (the same pages in black and white) and "… Deluxe Edition", three
// cards for one book. Only ever dropped together with the author check in
// collapseEditions, so "Spider-Man Noir" stays apart from Spider-Man: the two
// share no writer. "Absolute" alone is not here — Absolute Batman is a series of
// its own, by a writer who also wrote Batman. "Pen & Ink" is Noir under another
// name — "Animal Pound Pen & Ink #1" is #1 again in black and white, and sat
// outside the group the rest of the issues made. Matched after normalizeTitle has
// spelled the ampersand out.
const PACKAGING =
  /\b(?:(?:\d+(?:st|nd|rd|th)\s+)?anniversary|deluxe|noir|absolute|special|collectors?|expanded|definitive|new)\s+edition\b|\bnoir\b|\bpen and ink\b|\b(?:hardcover|paperback)\b/g

// The year a digital comics store adds to a series name — "(2024-)", "(2021)",
// "(2019-2020)" — so "The Last Halloween (2024-) #1" names the same series as
// the collected "The Last Halloween". Matched on the raw title, before
// normalising drops the brackets and leaves a bare year that looks like a word.
//
// Left out of the title, but not thrown away: it is also what tells one run of a
// series from the next. "Batman (2011-2016) #1" is Snyder's and "Batman (2016-)
// #1" King's, and the title alone makes them one series — see Run below.
const YEAR_TAG = /\(\s*(\d{4})\s*(?:([-–])\s*(\d{4})?\s*)?\)/g

// One run of a series, from its year tag: "(2016-)" is 2016 on, "(2011-2016)"
// those years, "(2021)" that year alone.
export interface Run {
  start: number
  // Null for a run the store still lists as open.
  end: number | null
}

// The last year tag in a title, which on an issue is the one just before its
// number. Null when the store gave none.
export function parseRun(title: string): Run | null {
  const match = [...title.matchAll(YEAR_TAG)].at(-1)
  if (!match) return null
  const start = Number(match[1])
  // "(2021)" has no dash: that year alone. "(2016-)" has one and no end: open.
  const end = match[3] ? Number(match[3]) : match[2] ? null : start
  return { start, end }
}

function runKey(run: Run): string {
  return `${run.start}-${run.end ?? ''}`
}

// How a run is written after a series' name: "(2016–)", "(2011–2016)", "(2021)".
function runLabel(run: Run): string {
  return run.end === run.start ? `(${run.start})` : `(${run.start}–${run.end ?? ''})`
}

function sameRun(a: Run | null, b: Run | null): boolean {
  return !a || !b || runKey(a) === runKey(b)
}

// Whether a year falls inside a run. An open run takes any year from its start.
function runHolds(run: Run, year: number): boolean {
  return year >= run.start && (run.end === null || year <= run.end)
}

// A series, run and all, as one key: the title as editionTitleKey compares it,
// and the run when the store named one. What series.ts keys a series' row on, so
// that Snyder's Batman and King's are two rows, and an untagged series stays
// keyed on its title as before.
export function seriesIdentity(series: string): string {
  const run = parseRun(series)
  return seriesKey(editionTitleKey(series), run)
}

function seriesKey(titleKey: string, run: Run | null): string {
  return run ? `${titleKey} ${runLabel(run)}` : titleKey
}

// Whether a title names a repackaging rather than the book itself. Of two
// editions otherwise equal, the plain one is kept — "Animal Pound #1" over
// "Animal Pound Pen & Ink #1" — and a series is named after its plain issues.
// A fresh RegExp each time, since PACKAGING is global and test() would carry
// lastIndex from one call to the next.
function isPackaged(title: string): boolean {
  return new RegExp(PACKAGING.source).test(normalizeTitle(title))
}

function withoutYearTag(title: string): string {
  return title.replace(YEAR_TAG, ' ').replace(/\s+/g, ' ').trim()
}

// Why not titleWordsFitInside: "Dune" fits inside "Dune Messiah", same author, a
// different novel. Dropping only words that name no other book keeps that apart.
export function editionTitleKey(title: string): string {
  return sameWorkKey(
    normalizeTitle(withoutYearTag(title))
      .replace(PACKAGING, ' ')
      .replace(FIRST_VOLUME, ' ')
      .replace(FILLER, ' '),
  )
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

export interface EditionFacts {
  title: string
  // Every credited name. An anthology's printings each put a different
  // contributor first — Creepshow Volume 1 came back as Chris Burnham's, Paul
  // Dini's and "AA.VV."'s — so the first name alone kept them apart. Empty when
  // the catalog names no one: two same-titled books with no author are as likely
  // to be different works as editions of one, so such a result only ever joins a
  // book its title names unambiguously.
  creators: string[]
  hasCover: boolean
  // Whether the person searching has this exact row in their log. The card that
  // shows their status is the one to keep, or their entry disappears from search.
  logged: boolean
}

function surnamesOf(fact: EditionFacts): Set<string> {
  return new Set(fact.creators.map(authorSurnameKey).filter(Boolean))
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
  // Two runs' #1s are different issues, even with a writer credited on both.
  const runs = facts.map((fact) => parseRun(fact.title))
  const surnames = facts.map(surnamesOf)

  // Union-find over indexes; each group's root is its best-ranked member.
  const parent = facts.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  for (let a = 0; a < facts.length; a++) {
    if (!titleKeys[a] || surnames[a]!.size === 0) continue
    for (let b = a + 1; b < facts.length; b++) {
      if (titleKeys[b] !== titleKeys[a]) continue
      if (!sameRun(runs[a]!, runs[b]!)) continue
      if (![...surnames[b]!].some((name) => surnames[a]!.has(name))) continue
      union(a, b)
    }
  }

  // A result with no author at all joins the book its title names, when only one
  // book among the results has that title: The Long Halloween came back a fourth
  // time with no author, cover or genre. With two books of one name (Snyder's
  // Batman Volume 1 and King's) it could be either, so it stays where it is.
  facts.forEach((_, index) => {
    if (!titleKeys[index] || surnames[index]!.size > 0) return
    const books = new Set(
      facts.flatMap((__, other) =>
        other !== index && titleKeys[other] === titleKeys[index] && surnames[other]!.size > 0
          ? [find(other)]
          : [],
      ),
    )
    if (books.size === 1) union(index, [...books][0]!)
  })

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
  const [plain, heldPlain] = [!isPackaged(candidate.title), !isPackaged(held.title)]
  if (plain !== heldPlain) return plain
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

interface ParsedIssue {
  // The series' name, without the run: "Batman" for "Batman (2016-) #3".
  series: string
  number: number
  run: Run | null
}

export function parseIssue(title: string): ParsedIssue | null {
  const match = ISSUE_SUFFIX.exec(title.trim())
  if (!match) return null
  const series = withoutYearTag(match[1]!).replace(/[\s:,–—-]+$/, '')
  return series ? { series, number: Number(match[2]), run: parseRun(match[1]!) } : null
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
  // The year it came out, for placing an issue or a volume with no year tag in a
  // run that has one. Left out, it goes by its title alone.
  year?: number | null
  // Every credited name, for telling two untagged runs of one title apart. See
  // splitByCredits.
  creators?: string[]
}

// Only results tagged as comics count as issues. The title pattern alone also fits
// numbered novel series — "Goosebumps #1", "Animorphs #2", "The Boxcar Children
// #3" — which are separate books a person searching for one wants to see, and
// which the page would mislabel as "single issues". A comic hit Google filed with
// no category at all is missed, and shows as an ordinary result: the safe way to
// be wrong.
//
// Grouped by the series title and run, not the author: one series' issues credit
// whichever writer Google picked first, Golden on one and Mignola on the next.
// The run is the store's year tag, which is what keeps Snyder's "Batman
// (2011-2016)" apart from King's "Batman (2016-)". An issue without one joins the
// run of its title whose years hold its own, when exactly one does; otherwise it
// is grouped by title alone, as every issue was before the tag was read —
// unless that leaves one issue number there twice, which is two runs no tag
// named; splitByCredits then parts them by who made them.
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
  const titleKeys = parsed.map((issue) => (issue ? editionTitleKey(issue.series) : ''))

  // Every run the results name for each series title.
  const runsOf = new Map<string, Map<string, Run>>()
  parsed.forEach((issue, index) => {
    if (!issue?.run) return
    const runs = runsOf.get(titleKeys[index]!) ?? new Map<string, Run>()
    runs.set(runKey(issue.run), issue.run)
    runsOf.set(titleKeys[index]!, runs)
  })

  const keys = parsed.map((issue, index) => {
    if (!issue) return ''
    const titleKey = titleKeys[index]!
    if (issue.run) return seriesKey(titleKey, issue.run)
    const year = facts[index]!.year
    const holding = [...(runsOf.get(titleKey)?.values() ?? [])].filter((run) => year != null && runHolds(run, year))
    return seriesKey(titleKey, holding.length === 1 ? holding[0]! : null)
  })

  const surnames = facts.map((fact) => new Set((fact.creators ?? []).map(authorSurnameKey).filter(Boolean)))
  const split = splitByCredits(keys, titleKeys, parsed, surnames)

  const members = new Map<string, number[]>()
  keys.forEach((key, index) => {
    if (key) members.set(key, [...(members.get(key) ?? []), index])
  })

  // Which group a comic that isn't itself an issue binds, if any: its own run
  // when it names one; the only group of its title when there is one; else the
  // run that had started by the year it came out — the latest such, since a
  // volume collects a run that is under way or over, never one yet to begin.
  const groupsOf = new Map<string, string[]>()
  for (const [key, indexes] of members) {
    const titleKey = titleKeys[indexes[0]!]!
    groupsOf.set(titleKey, [...(groupsOf.get(titleKey) ?? []), key])
  }
  //
  // Two runs parted by credits are told apart the same way: the volume goes
  // under the one it shares a credited name with, when only one does.
  const boundGroup = ({ title, year }: IssueFacts, credited: Set<string>): string | undefined => {
    const titleKey = editionTitleKey(title)
    const groups = groupsOf.get(titleKey) ?? []
    const run = parseRun(title)
    if (run) return groups.find((key) => key === seriesKey(titleKey, run))
    if (groups.length <= 1) return groups[0]
    const started = [...(runsOf.get(titleKey)?.values() ?? [])]
      .filter((r) => year != null && r.start <= year)
      .sort((a, b) => b.start - a.start)[0]
    const key = started ? seriesKey(titleKey, started) : titleKey
    if (groups.includes(key)) return key
    const sharing = groups.filter(
      (group) => split.has(group) && members.get(group)!.some((m) => [...surnames[m]!].some((n) => credited.has(n))),
    )
    return sharing.length === 1 ? sharing[0] : undefined
  }

  // The first comic that isn't itself an issue and names the same work.
  const collectedBy = new Map<string, number>()
  facts.forEach((fact, index) => {
    if (!fact.comic || parsed[index]) return
    const key = boundGroup(fact, surnames[index]!)
    if (key && !collectedBy.has(key)) collectedBy.set(key, index)
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
        ? {
            kind: 'issues',
            series: split.has(key)
              ? creditedName(seriesName(group.map((m) => parsed[m]!), key), group.map((m) => facts[m]!.creators ?? []))
              : seriesName(group.map((m) => parsed[m]!), key),
            issues: inNumberOrder(key),
          }
        : { kind: 'single', result: results[collected]!, issues: inNumberOrder(key) },
    )
  })
  return entries
}

// Two runs of one title the store tagged neither of. Snyder's Batman and King's
// both open with a #1, and with no year tag both are plain "Batman" — so when an
// issue number turns up twice under one untagged title (printings were folded
// together before this, so it is two issues, not two copies of one), the issues
// are parted by credit: those sharing a credited name, directly or through a
// third, are one run. Only then: credits are what Google Books gets wrong, an
// issue credited to its artist alone on one and its writer on the next, and
// used on every series they would break one run into several.
//
// An issue credited to no one, or to no one the others share, comes out as a run
// of its own; a run of one is shown as an ordinary result, so it is only loose,
// not mislabeled. Rewrites `keys` in place and returns the keys it made.
function splitByCredits(
  keys: string[],
  titleKeys: string[],
  parsed: (ParsedIssue | null)[],
  surnames: Set<string>[],
): Set<string> {
  const untagged = new Map<string, number[]>()
  keys.forEach((key, index) => {
    if (key && key === titleKeys[index]) untagged.set(key, [...(untagged.get(key) ?? []), index])
  })

  const made = new Set<string>()
  for (const [key, indexes] of untagged) {
    const numbers = indexes.map((index) => parsed[index]!.number)
    if (new Set(numbers).size === numbers.length) continue

    const parent = new Map(indexes.map((index) => [index, index]))
    const find = (index: number): number => {
      while (parent.get(index) !== index) index = parent.get(index)!
      return index
    }
    for (const a of indexes) {
      for (const b of indexes) {
        if (a < b && [...surnames[a]!].some((name) => surnames[b]!.has(name))) {
          parent.set(find(b), find(a))
        }
      }
    }
    const roots = [...new Set(indexes.map(find))]
    if (roots.length < 2) continue
    for (const index of indexes) {
      // Numbered by the run's best-ranked issue, so the key is the same however
      // the loop above happened to join them.
      keys[index] = `${key} ~${roots.indexOf(find(index))}`
      made.add(keys[index]!)
    }
  }
  return made
}

// What a group of issues is called: the best-ranked issue's series, unless that
// one is a repackaging and a plain issue came back too — with its run after it,
// when the group is one run of several ("Batman (2016–)"). seriesIdentity reads
// that back into the same key.
function seriesName(issues: ParsedIssue[], key: string): string {
  const name = (issues.find((issue) => !isPackaged(issue.series)) ?? issues[0]!).series
  const run = issues.find((issue) => issue.run && key.endsWith(` ${runLabel(issue.run)}`))?.run
  return run ? `${name} ${runLabel(run)}` : name
}

// A run parted by credits, named after the name credited on most of its issues
// — "Batman (King)" — since it has no year tag to be named by. The name is what
// its series row is keyed on (seriesIdentity), so it has to come out the same on
// the next search: the most credited name is the steadiest thing the issues
// carry, though not certain, since Google may credit the artist on more of
// them. Two runs parted this way share no credited name, so never a name here.
// A run credited to no one keeps the plain title.
function creditedName(series: string, credits: string[][]): string {
  const counts = new Map<string, { count: number; shown: string }>()
  for (const names of credits) {
    for (const name of new Set(names)) {
      const key = authorSurnameKey(name)
      if (!key) continue
      const words = name.trim().split(/\s+/)
      while (words.length > 1 && NAME_SUFFIX.has(normalizeTitle(words.at(-1)!))) words.pop()
      const held = counts.get(key)
      counts.set(key, { count: (held?.count ?? 0) + 1, shown: held?.shown ?? words.at(-1)! })
    }
  }
  // Ties go to the name met first, which is the best-ranked issue's.
  const top = [...counts.values()].reduce<{ count: number; shown: string } | null>(
    (best, entry) => (best && best.count >= entry.count ? best : entry),
    null,
  )
  return top ? `${series} (${top.shown})` : series
}

// What the book search page shows: printings collapsed to one card per book,
// then a comic's single issues gathered — in that order, so two printings of one
// issue count once.
export function arrangeBookResults<T>(
  results: T[],
  describe: (result: T) => EditionFacts & IssueFacts,
): SearchEntry<T>[] {
  return groupSingleIssues(collapseEditions(results, describe), describe)
}
