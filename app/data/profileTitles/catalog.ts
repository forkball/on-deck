// The titles a member can earn, and what earns each one.
//
// A title is two words worn together — an adjective and a noun, "Art House
// Projectionist". Every achievement here earns exactly one word, either an
// adjective (the first word) or a noun (the second). The two are chosen
// separately in settings, from whatever of each has been earned, so watching
// obscure films gets you "Art House" and a hundred films gets you
// "Projectionist".
//
// On the site each word is a "credit", as in a film's: the thing you're
// credited with. "Title word" was the working name and read like one.
//
// Every word is meant to be a joke about watching, reading or playing things —
// they're worn in public, under your name, so nothing a member would mind
// someone else reading there.
//
// Database-free, and importing nothing, so the rules are tested directly — the
// same reason classify.ts and exclusions.ts are. unlocks.ts gathers the stats and
// persists what they earn; nothing here knows where the numbers came from.

// One consumed entry from a member's log: what kind of thing it was, the
// catalog's genre tags for it, and its popularity, where the catalog gave one.
export interface ConsumedEntry {
  type: string
  tags: string[]
  popularity: number | null
}

export interface TitleStats {
  consumed: ConsumedEntry[]
  // Interactions with a star rating, and those at the top of the scale.
  rated: number
  topRated: number
  disliked: number
  withNotes: number
  wantToConsume: number
  notInterested: number
  // Rows written by an importer or a feed rather than by hand.
  imported: number
  following: number
  followers: number
  // Which media types a recommendation run exists for. Runs are pruned to the
  // last few per type, so a count of them would go down; whether a type has
  // ever had one can't.
  recommendedTypes: string[]
  luckyRuns: number
}

// Which slot a word goes in: adjectives are the first word, nouns the second.
export type TitlePart = 'adjective' | 'noun'

// What the two slots are called on the site: a title is a genre and a role,
// "Art House" + "Projectionist". Spelled once here so the pickers, both credit
// pages and the unlock notification can't each call them something else.
export const PART_NAMES: Record<TitlePart, { one: string; many: string }> = {
  adjective: { one: 'Genre', many: 'Genres' },
  noun: { one: 'Role', many: 'Roles' },
}

export interface TitleDefinition {
  key: string
  word: string
  part: TitlePart
  // How to earn it, as the settings page says it to someone who hasn't yet.
  requirement: string
  goal: number
  measure: (stats: TitleStats) => number
  // Held by everyone from the start: the title worn before anything is earned.
  starter?: boolean
}

// Below this TMDB popularity a film is one hardly anyone is looking up. Zero and
// null are excluded rather than counted: they mean the catalog didn't say.
export const OBSCURE_POPULARITY = 5

function consumedOfType(stats: TitleStats, type: string): number {
  return stats.consumed.filter((entry) => entry.type === type).length
}

// Entries carrying any of these tags, each entry counted once. Every medium is
// counted: a horror novel is as much horror as a horror film.
function consumedTagged(stats: TitleStats, ...tags: string[]): number {
  return stats.consumed.filter((entry) => entry.tags.some((tag) => tags.includes(tag))).length
}

function obscureFilms(stats: TitleStats): number {
  return stats.consumed.filter(
    (entry) =>
      entry.type === 'movie' &&
      entry.popularity != null &&
      entry.popularity > 0 &&
      entry.popularity < OBSCURE_POPULARITY,
  ).length
}

// In the order the settings page lists each part's words: the ones most people
// earn first, then taste, then volume, then habits, then the social ones.
//
// The two starter credits lead the list on purpose: a member's first title goes
// on automatically, from the first genre and role unlocked — see
// checkTitleUnlocks — and these are always the first.
export const TITLES: readonly TitleDefinition[] = [
  {
    key: 'newborn',
    word: 'Newborn',
    part: 'adjective',
    requirement: 'Join On Deck',
    goal: 0,
    measure: () => 0,
    starter: true,
  },
  {
    key: 'baby',
    word: 'Baby',
    part: 'noun',
    requirement: 'Join On Deck',
    goal: 0,
    measure: () => 0,
    starter: true,
  },
  {
    key: 'rookie',
    word: 'Background Extra',
    part: 'noun',
    requirement: 'Finish your first anything',
    goal: 1,
    measure: (stats) => stats.consumed.length,
  },
  {
    key: 'opinionated',
    word: 'Hot-Take',
    part: 'adjective',
    requirement: 'Rate your first anything',
    goal: 1,
    measure: (stats) => stats.rated,
  },
  {
    key: 'art_house',
    word: 'Art House',
    part: 'adjective',
    requirement: 'Watch 10 films hardly anyone else has looked up',
    goal: 10,
    measure: obscureFilms,
  },
  {
    key: 'horror',
    word: 'Jump-Scared',
    part: 'adjective',
    requirement: 'Finish 10 horror films, shows or books',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'horror'),
  },
  {
    key: 'sci_fi',
    word: 'Warp-Speed',
    part: 'adjective',
    requirement: 'Finish 10 science fiction anythings',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'science fiction', 'sci-fi & fantasy'),
  },
  {
    key: 'fantasy',
    word: 'Dragon-Riding',
    part: 'adjective',
    requirement: 'Finish 10 fantasy anythings',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'fantasy', 'sci-fi & fantasy'),
  },
  {
    key: 'documentary',
    word: 'Fact-Checking',
    part: 'adjective',
    requirement: 'Watch 10 documentaries',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'documentary'),
  },
  {
    key: 'animation',
    word: 'Hand-Drawn',
    part: 'adjective',
    requirement: 'Watch 10 animated films or shows',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'animation'),
  },
  {
    key: 'romance',
    word: 'Meet-Cute',
    part: 'adjective',
    requirement: 'Finish 10 romances',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'romance'),
  },
  {
    key: 'comedy',
    word: 'Laugh-Tracked',
    part: 'adjective',
    requirement: 'Watch 15 comedies',
    goal: 15,
    measure: (stats) => consumedTagged(stats, 'comedy'),
  },
  {
    key: 'mystery',
    word: 'Whodunit',
    part: 'adjective',
    requirement: 'Finish 15 mysteries or crime stories',
    goal: 15,
    measure: (stats) => consumedTagged(stats, 'mystery', 'crime'),
  },
  {
    key: 'western',
    word: 'Saddle-Sore',
    part: 'adjective',
    requirement: 'Watch 5 westerns',
    goal: 5,
    measure: (stats) => consumedTagged(stats, 'western'),
  },
  {
    key: 'rpg',
    word: 'Side-Quester',
    part: 'noun',
    requirement: 'Play 10 role-playing games',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'role-playing (rpg)'),
  },
  {
    key: 'shooter',
    word: 'Trigger-Happy',
    part: 'adjective',
    requirement: 'Play 10 shooters',
    goal: 10,
    measure: (stats) => consumedTagged(stats, 'shooter'),
  },
  {
    key: 'cinephile',
    word: 'Popcorn Muncher',
    part: 'noun',
    requirement: 'Watch 50 films',
    goal: 50,
    measure: (stats) => consumedOfType(stats, 'movie'),
  },
  {
    key: 'projectionist',
    word: 'Projectionist',
    part: 'noun',
    requirement: 'Watch 100 films',
    goal: 100,
    measure: (stats) => consumedOfType(stats, 'movie'),
  },
  {
    key: 'film_freak',
    word: 'Cinema Goblin',
    part: 'noun',
    requirement: 'Watch 250 films',
    goal: 250,
    measure: (stats) => consumedOfType(stats, 'movie'),
  },
  {
    key: 'couch_potato',
    word: 'Couch Potato',
    part: 'noun',
    requirement: 'Finish 20 shows',
    goal: 20,
    measure: (stats) => consumedOfType(stats, 'tv'),
  },
  {
    key: 'bookworm',
    word: 'Page-Turner',
    part: 'noun',
    requirement: 'Read 25 books',
    goal: 25,
    measure: (stats) => consumedOfType(stats, 'book'),
  },
  {
    key: 'gamer',
    word: 'Button Masher',
    part: 'noun',
    requirement: 'Play 25 games',
    goal: 25,
    measure: (stats) => consumedOfType(stats, 'game'),
  },
  {
    key: 'polymath',
    word: 'Media Omnivore',
    part: 'noun',
    requirement: 'Finish 5 each of films, shows, books and games',
    goal: 5,
    measure: (stats) =>
      Math.min(...['movie', 'tv', 'book', 'game'].map((type) => consumedOfType(stats, type))),
  },
  {
    key: 'critic',
    word: 'Armchair Critic',
    part: 'noun',
    requirement: 'Rate 50 things',
    goal: 50,
    measure: (stats) => stats.rated,
  },
  {
    key: 'superfan',
    word: 'Stan',
    part: 'noun',
    requirement: 'Give 25 things five stars',
    goal: 25,
    measure: (stats) => stats.topRated,
  },
  {
    key: 'salty',
    word: 'Certified Rotten',
    part: 'adjective',
    requirement: 'Mark 10 things as disliked',
    goal: 10,
    measure: (stats) => stats.disliked,
  },
  {
    key: 'verbose',
    word: 'Footnoted',
    part: 'adjective',
    requirement: 'Write notes on 20 things',
    goal: 20,
    measure: (stats) => stats.withNotes,
  },
  {
    key: 'hoarder',
    word: 'Watchlist Hoarder',
    part: 'noun',
    requirement: 'Have 30 things on your want-to list',
    goal: 30,
    measure: (stats) => stats.wantToConsume,
  },
  {
    key: 'picky',
    word: 'Channel-Flipping',
    part: 'adjective',
    requirement: 'Turn down 20 things as not interested',
    goal: 20,
    measure: (stats) => stats.notInterested,
  },
  {
    key: 'archivist',
    word: 'VHS Collector',
    part: 'noun',
    requirement: 'Bring 100 entries in from an import or a connected account',
    goal: 100,
    measure: (stats) => stats.imported,
  },
  {
    key: 'curious',
    word: 'Algorithm-Fed',
    part: 'adjective',
    requirement: 'Get recommendations for films, shows, books and games',
    goal: 4,
    measure: (stats) => new Set(stats.recommendedTypes).size,
  },
  {
    key: 'lucky',
    word: 'Shuffle-Mode',
    part: 'adjective',
    requirement: "Draw a day's lucky pick",
    goal: 1,
    measure: (stats) => stats.luckyRuns,
  },
  {
    key: 'nosy',
    word: 'Subscribed',
    part: 'adjective',
    requirement: 'Follow 10 people',
    goal: 10,
    measure: (stats) => stats.following,
  },
  {
    key: 'popular',
    word: 'Red-Carpet',
    part: 'adjective',
    requirement: 'Be followed by 10 people',
    goal: 10,
    measure: (stats) => stats.followers,
  },
]

const TITLES_BY_KEY = new Map(TITLES.map((title) => [title.key, title]))

export function titleByKey(key: string | null | undefined): TitleDefinition | undefined {
  return key == null ? undefined : TITLES_BY_KEY.get(key)
}

export interface TitleProgress {
  title: TitleDefinition
  current: number
  earned: boolean
}

export function titleProgress(stats: TitleStats): TitleProgress[] {
  return TITLES.map((title) => {
    const current = title.measure(stats)
    return { title, current, earned: current >= title.goal }
  })
}

export function earnedTitleKeys(stats: TitleStats): string[] {
  return titleProgress(stats)
    .filter((progress) => progress.earned)
    .map((progress) => progress.title.key)
}

export function titlesOfPart(part: TitlePart): TitleDefinition[] {
  return TITLES.filter((title) => title.part === part)
}

// A key, if it names a word of this part — an adjective key is no noun.
function wordOf(key: string | null | undefined, part: TitlePart): string | undefined {
  const title = titleByKey(key)
  return title?.part === part ? title.word : undefined
}

// What a member is called, from the two keys they chose. Either half may be
// unset — someone can wear just a noun — and a key no longer in the catalog
// reads as unset rather than as a blank word.
export function composeTitle(
  adjectiveKey: string | null | undefined,
  nounKey: string | null | undefined,
): string | null {
  const words = [wordOf(adjectiveKey, 'adjective'), wordOf(nounKey, 'noun')].filter(
    (word): word is string => word != null,
  )
  return words.length > 0 ? words.join(' ') : null
}

// A choice from the settings form, checked against what has been unlocked. An
// empty value clears that half; a key not unlocked, or in the wrong slot, is
// refused outright rather than quietly dropped, since only a hand-made request
// could send one.
export function parseTitleChoice(
  raw: { adjective: string; noun: string },
  unlocked: ReadonlySet<string>,
): { adjective: string | null; noun: string | null } | null {
  const pick = (value: string, part: TitlePart): string | null | undefined => {
    const key = value.trim()
    if (key === '') return null
    return unlocked.has(key) && wordOf(key, part) != null ? key : undefined
  }
  const adjective = pick(raw.adjective, 'adjective')
  const noun = pick(raw.noun, 'noun')
  if (adjective === undefined || noun === undefined) return null
  return { adjective, noun }
}
