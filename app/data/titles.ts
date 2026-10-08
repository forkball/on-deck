// How a title is compared, everywhere it is compared.
//
// There were five copies of this rule: the recommendation matcher, the CSV
// importers' classifier, the Steam importer, IGDB's relevance ranking, and the
// Google Books backfill script. They disagreed about the ampersand. The matcher had
// learned that "&" means the word — publishers print "The Wrath & the Dawn" and "The
// Wrath and the Dawn" for one book — and the other four had not.
//
// The cost of that landed on people rather than on a metric: a Goodreads row for
// "Fire & Blood" against a catalog "Fire and Blood" read as a different title, so
// classifyMatch returned title_differs and the row went to the review queue for
// someone to settle by hand. On the game path, IGDB's "Ratchet and Clank" never
// ranked as an exact match for a search for "Ratchet & Clank".
//
// The spelling is the matcher's: punctuation is deleted rather than replaced with a
// space, so "Spider-Man" is "Spiderman", "S.W.A.T." is "SWAT" and "Kushiel's Dart"
// is "Kushiels Dart" — all pairs the catalogs genuinely print both ways. It loses the
// opposite pair, "WALL-E" against "Wall E", which the importers' spelling caught;
// titlesLikelyMatch's similarity check covers that one at 0.8, and a review question
// covers it on the import path. Which of the two spellings is right in general is a
// real question with a measurable answer, and not one to settle inside a change that
// is otherwise about there being five of them.
// Accents folded to the letter underneath, not dropped: stripping anything outside
// a-z turns "Brontë" into "bront", which matches nothing spelled "Bronte". The two
// sides of a comparison always come from different catalogs, which disagree on this.
//
// NFD splits a letter from its accent so the accent can be dropped, which handles é,
// ü, å and the rest. It does nothing for the letters that are not a base plus a mark
// but characters in their own right — ø, æ, ß, ł — so those are spelled out.
const STRUCK_THROUGH: [from: RegExp, to: string][] = [
  [/ø/g, 'o'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ß/g, 'ss'],
  [/ł/g, 'l'],
  [/đ|ð/g, 'd'],
  [/þ/g, 'th'],
]

function foldAccents(text: string): string {
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return STRUCK_THROUGH.reduce((carried, [from, to]) => carried.replace(from, to), folded)
}

export function normalizeTitle(title: string): string {
  const folded = foldAccents(title)
  return (
    folded
      .toLowerCase()
      // Before the punctuation pass, or the symbol is simply dropped and "The Wrath &
      // the Dawn" stops being "The Wrath and the Dawn".
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

// Where a subtitle starts, for comparing the main title alone. Stripped at the
// separator rather than by prefix: "Foundation" is a prefix of "Foundation and
// Empire", a different novel.
//
// Its own separator set, narrower than the importers' SUBTITLE_SEPARATOR in
// classify.ts, which also splits on " - ". Reconciling the two is worth doing and is
// not this change.
export function withoutSubtitle(title: string): string {
  const [main] = title.split(/\s*[:–—]\s*/)
  return normalizeTitle(main ?? title)
}

// How a person's name is compared. Spaces go too, unlike a title: catalogs and
// models disagree about how to space initials — "J.R.R. Tolkien" against "J. R. R.
// Tolkien" — and a name is one token to a reader either way.
export function normalizeName(name: string | null | undefined): string {
  return foldAccents(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// Whether two titles name the same work, for a caller that must not get it wrong.
//
// Word sets rather than edit distance, which ranked these backwards: "Dune House
// Corrino" scored higher against "Dune: The Battle of Corrin" — a different novel —
// than "House Corrino: Dune" did against "Dune: House Corrino".
export function titlesNameSameWork(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true

  // The same words in a different order, which is how two catalogs disagree about
  // where a series name belongs: "Twelfth Night, or What You Will" against
  // "Twelfth Night: Or, What You Will".
  const words = new Set(na.split(' '))
  const other = new Set(nb.split(' '))
  if (words.size !== other.size) return false
  for (const word of words) if (!other.has(word)) return false
  return true
}

// What titlesNameSameWork compares: a title's distinct words, in a fixed order. Two
// titles name the same work exactly when their keys are equal and not empty, so a
// title checked against a long list — a person's whole log — keys the list once
// into a Set instead of normalising every pair. Empty for a title with no words.
export function sameWorkKey(title: string): string {
  const normalized = normalizeTitle(title)
  if (!normalized) return ''
  return [...new Set(normalized.split(' '))].sort().join(' ')
}

// Whether every word of one title appears in the other. Separate from the above, and
// never sufficient alone: "The Goldfinch" sits inside "The Goldfinch: A Novel" exactly
// as "Dune" sits inside "Dune: House Harkonnen". Only the author separates a subtitle
// from a sequel, so callers check that too.
export function titleWordsFitInside(shorter: string, longer: string): boolean {
  const inner = normalizeTitle(shorter)
  const outer = new Set(normalizeTitle(longer).split(' '))
  if (!inner || outer.size === 0) return false
  return inner.split(' ').every((word) => outer.has(word))
}
