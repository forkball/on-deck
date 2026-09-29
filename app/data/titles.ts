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

// The same rule for Postgres to run, because resolveFromCatalog compares a stored
// row's title to a pick's inside the query — in a select list and in a filter, so it
// has to agree with itself as well as with the function above.
// test/catalog-shortcut.test.ts is what holds the three spellings together, and it
// needs a database, so it is the weakest link in this arrangement: see the note in
// resolveFromCatalog about doing the comparison in TypeScript instead.
export const NORMALIZED_TITLE_SQL =
  "btrim(regexp_replace(regexp_replace(replace(lower(title), '&', ' and '), '[^a-z0-9[:space:]]', '', 'g'), '\\s+', ' ', 'g'))"

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
