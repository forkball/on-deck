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
export function normalizeTitle(title: string): string {
  return (
    title
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
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Whether two titles name the same work on their own evidence, for a caller that
// must not get it wrong. scripts/backfill-google-books.ts repoints a row everyone's
// log points at, so a false match writes the wrong book into other people's
// histories.
//
// Word sets, not character distance. An edit ratio measures the wrong thing here,
// and measured it backwards: "Dune House Corrino" against "Dune: The Battle of
// Corrin" scored 0.52 on shared letters and was accepted — a different novel —
// while "House Corrino: Dune" against "Dune: House Corrino" scored 0.44 and was
// rejected. No threshold separates those two, because the metric rewards incidental
// overlap and penalises reordering, the one difference that doesn't matter.
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

// Whether every word of one title appears in the other. Not sufficient on its own,
// which is the whole reason it is separate: "The Goldfinch" sits inside "The
// Goldfinch: A Novel", and "Dune" sits inside "Dune: House Harkonnen" exactly the
// same way. Nothing in the words says which of those two is a subtitle and which is
// a different novel — withoutSubtitle can't tell either, since it only knows where
// the colon is. A caller pairs this with something that can: the author, who is
// Frank Herbert for one Dune and Brian Herbert for the other.
export function titleWordsFitInside(shorter: string, longer: string): boolean {
  const inner = normalizeTitle(shorter)
  const outer = new Set(normalizeTitle(longer).split(' '))
  if (!inner || outer.size === 0) return false
  return inner.split(' ').every((word) => outer.has(word))
}
