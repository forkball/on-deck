// The credits a member can earn, and what earns each one.
//
// A title is two words worn together: a genre and a role, "Art House
// Projectionist". Every achievement here earns exactly one word — a credit, as
// in a film's — which is either a genre (an adjective, the first word) or a
// role (a noun, the second). The two are chosen separately in settings from
// whatever of each has been earned, so watching obscure films gets you "Art
// House" and a hundred films gets you "Projectionist".
//
// In code a credit is a TitleDefinition and its key is a "title key", which is
// what user_titles stores; "credit", "genre" and "role" are the site's words.
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

// A genre's credits come as a ladder: one word at 5, 10, 50 and 100 of it,
// alternating between genres and roles so every genre gives two of each. The
// 10 rung of most is the genre's original credit, which keeps its key — the
// key is what user_titles stores and what a member wears — so nobody lost a
// credit or a title when the ladders went in. New rungs are keyed
// `<genre>_<goal>`.
interface GenreLadder {
  measure: (stats: TitleStats) => number
  // How the requirement reads for a count: "Finish 50 horror films, shows or books".
  requirement: (count: number) => string
  rungs: { goal: number; key: string; word: string; part: TitlePart }[]
}

function ladderCredits(ladder: GenreLadder): TitleDefinition[] {
  return ladder.rungs.map((rung) => ({
    key: rung.key,
    word: rung.word,
    part: rung.part,
    requirement: ladder.requirement(rung.goal),
    goal: rung.goal,
    measure: ladder.measure,
  }))
}

const GENRE_LADDERS: GenreLadder[] = [
  {
    measure: obscureFilms,
    requirement: (n) => `Watch ${n} films hardly anyone else has looked up`,
    rungs: [
      { goal: 5, key: 'art_house_5', word: 'Subtitled', part: 'adjective' },
      { goal: 10, key: 'art_house', word: 'Art House', part: 'adjective' },
      { goal: 50, key: 'art_house_50', word: 'Auteur', part: 'noun' },
      { goal: 100, key: 'art_house_100', word: 'Criterion Completist', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'horror'),
    requirement: (n) => `Finish ${n} horror films, shows or books`,
    rungs: [
      { goal: 5, key: 'horror_5', word: 'Squeamish', part: 'adjective' },
      { goal: 10, key: 'horror', word: 'Jump-Scared', part: 'adjective' },
      { goal: 50, key: 'horror_50', word: 'Final Girl', part: 'noun' },
      { goal: 100, key: 'horror_100', word: 'Gorehound', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'science fiction', 'sci-fi & fantasy'),
    requirement: (n) => `Finish ${n} science fiction films, shows or books`,
    rungs: [
      { goal: 5, key: 'sci_fi_5', word: 'Spacey', part: 'adjective' },
      { goal: 10, key: 'sci_fi', word: 'Warp-Speed', part: 'adjective' },
      { goal: 50, key: 'sci_fi_50', word: 'Space Cadet', part: 'noun' },
      { goal: 100, key: 'sci_fi_100', word: 'Time Traveller', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'fantasy', 'sci-fi & fantasy'),
    requirement: (n) => `Finish ${n} fantasy films, shows, books or games`,
    rungs: [
      { goal: 5, key: 'fantasy_5', word: 'Spellbound', part: 'adjective' },
      { goal: 10, key: 'fantasy', word: 'Dragon-Riding', part: 'adjective' },
      { goal: 50, key: 'fantasy_50', word: 'Dungeon Master', part: 'noun' },
      { goal: 100, key: 'fantasy_100', word: 'Elder Wizard', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'documentary'),
    requirement: (n) => `Watch ${n} documentaries`,
    rungs: [
      { goal: 5, key: 'documentary_5', word: 'True-Story', part: 'adjective' },
      { goal: 10, key: 'documentary', word: 'Fact-Checking', part: 'adjective' },
      { goal: 50, key: 'documentary_50', word: 'Know-It-All', part: 'noun' },
      { goal: 100, key: 'documentary_100', word: 'Narrator', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'animation'),
    requirement: (n) => `Watch ${n} animated films or shows`,
    rungs: [
      { goal: 5, key: 'animation_5', word: 'Cel-Shaded', part: 'adjective' },
      { goal: 10, key: 'animation', word: 'Hand-Drawn', part: 'adjective' },
      { goal: 50, key: 'animation_50', word: 'Toon Fiend', part: 'noun' },
      { goal: 100, key: 'animation_100', word: 'Animator', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'romance'),
    requirement: (n) => `Finish ${n} romances`,
    rungs: [
      { goal: 5, key: 'romance_5', word: 'Lovestruck', part: 'adjective' },
      { goal: 10, key: 'romance', word: 'Meet-Cute', part: 'adjective' },
      { goal: 50, key: 'romance_50', word: 'Hopeless Romantic', part: 'noun' },
      { goal: 100, key: 'romance_100', word: 'Rom-Com Royalty', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'comedy'),
    requirement: (n) => `Watch ${n} comedies`,
    rungs: [
      { goal: 5, key: 'comedy_5', word: 'Chuckling', part: 'adjective' },
      { goal: 10, key: 'comedy', word: 'Laugh-Tracked', part: 'adjective' },
      { goal: 50, key: 'comedy_50', word: 'Class Clown', part: 'noun' },
      { goal: 100, key: 'comedy_100', word: 'Comedy Nerd', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'mystery', 'crime'),
    requirement: (n) => `Finish ${n} mysteries or crime stories`,
    rungs: [
      { goal: 5, key: 'mystery_5', word: 'Suspicious', part: 'adjective' },
      { goal: 10, key: 'mystery', word: 'Whodunit', part: 'adjective' },
      { goal: 50, key: 'mystery_50', word: 'Sleuth', part: 'noun' },
      { goal: 100, key: 'mystery_100', word: 'Master Detective', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'western'),
    requirement: (n) => `Watch ${n} westerns`,
    rungs: [
      // Westerns started at 5, so the original credit is the bottom rung here.
      { goal: 5, key: 'western', word: 'Saddle-Sore', part: 'adjective' },
      { goal: 10, key: 'western_10', word: 'Dusty', part: 'adjective' },
      { goal: 50, key: 'western_50', word: 'Cowpoke', part: 'noun' },
      { goal: 100, key: 'western_100', word: 'Gunslinger', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'role-playing (rpg)'),
    requirement: (n) => `Play ${n} role-playing games`,
    rungs: [
      // The original RPG credit is a role, so this ladder alternates the other way.
      { goal: 5, key: 'rpg_5', word: 'Grinding', part: 'adjective' },
      { goal: 10, key: 'rpg', word: 'Side-Quester', part: 'noun' },
      { goal: 50, key: 'rpg_50', word: 'Overleveled', part: 'adjective' },
      { goal: 100, key: 'rpg_100', word: 'Final Boss', part: 'noun' },
    ],
  },
  {
    measure: (stats) => consumedTagged(stats, 'shooter'),
    requirement: (n) => `Play ${n} shooters`,
    rungs: [
      { goal: 5, key: 'shooter_5', word: 'Locked-and-Loaded', part: 'adjective' },
      { goal: 10, key: 'shooter', word: 'Trigger-Happy', part: 'adjective' },
      { goal: 50, key: 'shooter_50', word: 'Sharpshooter', part: 'noun' },
      { goal: 100, key: 'shooter_100', word: 'One-Man Army', part: 'noun' },
    ],
  },
]

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
  ...GENRE_LADDERS.flatMap(ladderCredits),
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
