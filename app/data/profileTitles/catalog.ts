// The credits a member can earn, and what earns each one.
//
// A title is two words worn together: a genre and a role, "Art House
// Projectionist". Every achievement here earns exactly one word — a credit, as
// in a film's — which is either a genre (an adjective, the first word) or a
// role (a noun, the second). The two are chosen separately, on your profile, from
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
  // How to earn it, as the Titles tab says it to someone who hasn't yet.
  requirement: string
  goal: number
  measure: (stats: TitleStats) => number
  // What earns it, as the Titles tab's filter names it: "Horror", "Films",
  // "Social". A ladder's rungs share their ladder's.
  group: string
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

// A genre's credits — and a medium's — come as a ladder: one word at 5, 10, 50 and 100 of it,
// alternating between genres and roles so every genre gives two of each. The
// 10 rung of most is the genre's original credit, which keeps its key — the
// key is what user_titles stores and what a member wears — so nobody lost a
// credit or a title when the ladders went in. New rungs are keyed
// `<genre>_<goal>`.
interface Ladder {
  group: string
  // The catalog genre tags it counts, each entry once — or, for a ladder that
  // isn't a genre (a medium, obscurity), `measure`. Tags are data rather than
  // a closure so a test can hold every one against what the catalogs return:
  // a misspelt tag is a ladder nobody can climb.
  tags?: string[]
  measure?: (stats: TitleStats) => number
  // How the requirement reads for a count: "Finish 50 horror films, shows or books".
  requirement: (count: number) => string
  rungs: { goal: number; key: string; word: string; part: TitlePart }[]
}

function ladderCredits(ladder: Ladder): TitleDefinition[] {
  return ladder.rungs.map((rung) => ({
    key: rung.key,
    word: rung.word,
    part: rung.part,
    requirement: ladder.requirement(rung.goal),
    goal: rung.goal,
    measure: ladder.measure ?? ((stats: TitleStats) => consumedTagged(stats, ...(ladder.tags ?? []))),
    group: ladder.group,
  }))
}

const GENRE_LADDERS: Ladder[] = [
  {
    group: 'Art House',
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
    group: 'Horror',
    tags: ['horror'],
    requirement: (n) => `Finish ${n} horror films, shows or books`,
    rungs: [
      { goal: 5, key: 'horror_5', word: 'Squeamish', part: 'adjective' },
      { goal: 10, key: 'horror', word: 'Jump-Scared', part: 'adjective' },
      { goal: 50, key: 'horror_50', word: 'Final Girl', part: 'noun' },
      { goal: 100, key: 'horror_100', word: 'Gorehound', part: 'noun' },
    ],
  },
  {
    group: 'Sci-fi',
    tags: ['science fiction', 'sci-fi & fantasy'],
    requirement: (n) => `Finish ${n} science fiction films, shows or books`,
    rungs: [
      { goal: 5, key: 'sci_fi_5', word: 'Spacey', part: 'adjective' },
      { goal: 10, key: 'sci_fi', word: 'Warp-Speed', part: 'adjective' },
      { goal: 50, key: 'sci_fi_50', word: 'Space Cadet', part: 'noun' },
      { goal: 100, key: 'sci_fi_100', word: 'Time Traveller', part: 'noun' },
    ],
  },
  {
    group: 'Fantasy',
    tags: ['fantasy', 'sci-fi & fantasy'],
    requirement: (n) => `Finish ${n} fantasy films, shows, books or games`,
    rungs: [
      { goal: 5, key: 'fantasy_5', word: 'Spellbound', part: 'adjective' },
      { goal: 10, key: 'fantasy', word: 'Dragon-Riding', part: 'adjective' },
      { goal: 50, key: 'fantasy_50', word: 'Dungeon Master', part: 'noun' },
      { goal: 100, key: 'fantasy_100', word: 'Elder Wizard', part: 'noun' },
    ],
  },
  {
    group: 'Documentary',
    tags: ['documentary'],
    requirement: (n) => `Watch ${n} documentaries`,
    rungs: [
      { goal: 5, key: 'documentary_5', word: 'True-Story', part: 'adjective' },
      { goal: 10, key: 'documentary', word: 'Fact-Checking', part: 'adjective' },
      { goal: 50, key: 'documentary_50', word: 'Know-It-All', part: 'noun' },
      { goal: 100, key: 'documentary_100', word: 'Narrator', part: 'noun' },
    ],
  },
  {
    group: 'Animation',
    tags: ['animation'],
    requirement: (n) => `Watch ${n} animated films or shows`,
    rungs: [
      { goal: 5, key: 'animation_5', word: 'Cel-Shaded', part: 'adjective' },
      { goal: 10, key: 'animation', word: 'Hand-Drawn', part: 'adjective' },
      { goal: 50, key: 'animation_50', word: 'Toon Fiend', part: 'noun' },
      { goal: 100, key: 'animation_100', word: 'Animator', part: 'noun' },
    ],
  },
  {
    group: 'Romance',
    tags: ['romance'],
    requirement: (n) => `Finish ${n} romances`,
    rungs: [
      { goal: 5, key: 'romance_5', word: 'Lovestruck', part: 'adjective' },
      { goal: 10, key: 'romance', word: 'Meet-Cute', part: 'adjective' },
      { goal: 50, key: 'romance_50', word: 'Hopeless Romantic', part: 'noun' },
      { goal: 100, key: 'romance_100', word: 'Rom-Com Royalty', part: 'noun' },
    ],
  },
  {
    group: 'Comedy',
    tags: ['comedy'],
    requirement: (n) => `Watch ${n} comedies`,
    rungs: [
      { goal: 5, key: 'comedy_5', word: 'Chuckling', part: 'adjective' },
      { goal: 10, key: 'comedy', word: 'Laugh-Tracked', part: 'adjective' },
      { goal: 50, key: 'comedy_50', word: 'Class Clown', part: 'noun' },
      { goal: 100, key: 'comedy_100', word: 'Comedy Nerd', part: 'noun' },
    ],
  },
  {
    group: 'Mystery & crime',
    tags: ['mystery', 'crime'],
    requirement: (n) => `Finish ${n} mysteries or crime stories`,
    rungs: [
      { goal: 5, key: 'mystery_5', word: 'Suspicious', part: 'adjective' },
      { goal: 10, key: 'mystery', word: 'Whodunit', part: 'adjective' },
      { goal: 50, key: 'mystery_50', word: 'Sleuth', part: 'noun' },
      { goal: 100, key: 'mystery_100', word: 'Master Detective', part: 'noun' },
    ],
  },
  {
    group: 'Westerns',
    tags: ['western'],
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
    group: 'RPGs',
    tags: ['role-playing (rpg)'],
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
    group: 'Shooters',
    tags: ['shooter'],
    requirement: (n) => `Play ${n} shooters`,
    rungs: [
      { goal: 5, key: 'shooter_5', word: 'Locked-and-Loaded', part: 'adjective' },
      { goal: 10, key: 'shooter', word: 'Trigger-Happy', part: 'adjective' },
      { goal: 50, key: 'shooter_50', word: 'Sharpshooter', part: 'noun' },
      { goal: 100, key: 'shooter_100', word: 'One-Man Army', part: 'noun' },
    ],
  },
  // The genres added after the first twelve — every one the catalogs use
  // that people log for fun. Where catalogs split one idea several ways (TV's
  // "action & adventure", IGDB's four kinds of strategy) a ladder counts them
  // together, each entry once.
  {
    group: 'Drama',
    tags: ['drama'],
    requirement: (n) => `Watch ${n} dramas`,
    rungs: [
      { goal: 5, key: 'drama_5', word: 'Weepy', part: 'adjective' },
      { goal: 10, key: 'drama_10', word: 'Oscar-Baiting', part: 'adjective' },
      { goal: 50, key: 'drama_50', word: 'Method Actor', part: 'noun' },
      { goal: 100, key: 'drama_100', word: 'Thespian', part: 'noun' },
    ],
  },
  {
    group: 'Action',
    tags: ['action', 'action & adventure'],
    requirement: (n) => `Watch ${n} action films or shows`,
    rungs: [
      { goal: 5, key: 'action_5', word: 'Explosive', part: 'adjective' },
      { goal: 10, key: 'action_10', word: 'Slow-Motion', part: 'adjective' },
      { goal: 50, key: 'action_50', word: 'Stunt Double', part: 'noun' },
      { goal: 100, key: 'action_100', word: 'Action Hero', part: 'noun' },
    ],
  },
  {
    group: 'Adventure',
    tags: ['adventure', 'action & adventure'],
    requirement: (n) => `Finish ${n} adventures`,
    rungs: [
      { goal: 5, key: 'adventure_5', word: 'Swashbuckling', part: 'adjective' },
      { goal: 10, key: 'adventure_10', word: 'Map-Reading', part: 'adjective' },
      { goal: 50, key: 'adventure_50', word: 'Treasure Hunter', part: 'noun' },
      { goal: 100, key: 'adventure_100', word: 'Explorer', part: 'noun' },
    ],
  },
  {
    group: 'Thrillers',
    tags: ['thriller'],
    requirement: (n) => `Finish ${n} thrillers`,
    rungs: [
      { goal: 5, key: 'thriller_5', word: 'Edge-of-Seat', part: 'adjective' },
      { goal: 10, key: 'thriller_10', word: 'Twist-Ending', part: 'adjective' },
      { goal: 50, key: 'thriller_50', word: 'Nail-Biter', part: 'noun' },
      { goal: 100, key: 'thriller_100', word: 'Mastermind', part: 'noun' },
    ],
  },
  {
    group: 'History',
    tags: ['history', 'historical'],
    requirement: (n) => `Finish ${n} history or historical films, shows or books`,
    rungs: [
      { goal: 5, key: 'history_5', word: 'Period-Piece', part: 'adjective' },
      { goal: 10, key: 'history_10', word: 'Costumed', part: 'adjective' },
      { goal: 50, key: 'history_50', word: 'History Buff', part: 'noun' },
      { goal: 100, key: 'history_100', word: 'Historian', part: 'noun' },
    ],
  },
  {
    group: 'War',
    tags: ['war', 'war & politics'],
    requirement: (n) => `Finish ${n} war films or shows`,
    rungs: [
      { goal: 5, key: 'war_5', word: 'Shell-Shocked', part: 'adjective' },
      { goal: 10, key: 'war_10', word: 'Battle-Hardened', part: 'adjective' },
      { goal: 50, key: 'war_50', word: 'Foot Soldier', part: 'noun' },
      { goal: 100, key: 'war_100', word: 'Field Marshal', part: 'noun' },
    ],
  },
  {
    group: 'Family & kids',
    tags: ['family', 'kids'],
    requirement: (n) => `Watch ${n} family or kids' films or shows`,
    rungs: [
      { goal: 5, key: 'family_5', word: 'Wholesome', part: 'adjective' },
      { goal: 10, key: 'family_10', word: 'Rated-G', part: 'adjective' },
      { goal: 50, key: 'family_50', word: 'Babysitter', part: 'noun' },
      { goal: 100, key: 'family_100', word: 'Kid at Heart', part: 'noun' },
    ],
  },
  {
    group: 'Music',
    tags: ['music'],
    requirement: (n) => `Finish ${n} music films or games`,
    rungs: [
      { goal: 5, key: 'music_5', word: 'Toe-Tapping', part: 'adjective' },
      { goal: 10, key: 'music_10', word: 'Chart-Topping', part: 'adjective' },
      { goal: 50, key: 'music_50', word: 'Roadie', part: 'noun' },
      { goal: 100, key: 'music_100', word: 'Rock Star', part: 'noun' },
    ],
  },
  {
    group: 'Reality TV',
    tags: ['reality', 'soap', 'talk'],
    requirement: (n) => `Finish ${n} reality, soap or talk shows`,
    rungs: [
      { goal: 5, key: 'reality_5', word: 'Unscripted', part: 'adjective' },
      { goal: 10, key: 'reality_10', word: 'Cliffhanging', part: 'adjective' },
      { goal: 50, key: 'reality_50', word: 'Couch Commentator', part: 'noun' },
      { goal: 100, key: 'reality_100', word: 'Reality Star', part: 'noun' },
    ],
  },
  {
    group: 'Biography',
    tags: ['biography'],
    requirement: (n) => `Read ${n} biographies`,
    rungs: [
      { goal: 5, key: 'biography_5', word: 'True-to-Life', part: 'adjective' },
      { goal: 10, key: 'biography_10', word: 'Larger-than-Life', part: 'adjective' },
      { goal: 50, key: 'biography_50', word: 'Biographer', part: 'noun' },
      { goal: 100, key: 'biography_100', word: 'Ghostwriter', part: 'noun' },
    ],
  },
  {
    group: 'Young adult',
    tags: ['young adult'],
    requirement: (n) => `Read ${n} young adult books`,
    rungs: [
      { goal: 5, key: 'young_adult_5', word: 'Angsty', part: 'adjective' },
      { goal: 10, key: 'young_adult_10', word: 'Coming-of-Age', part: 'adjective' },
      { goal: 50, key: 'young_adult_50', word: 'Love Interest', part: 'noun' },
      { goal: 100, key: 'young_adult_100', word: 'Chosen One', part: 'noun' },
    ],
  },
  {
    group: 'Graphic novels',
    tags: ['graphic novel'],
    requirement: (n) => `Read ${n} graphic novels`,
    rungs: [
      { goal: 5, key: 'graphic_novel_5', word: 'Inked', part: 'adjective' },
      { goal: 10, key: 'graphic_novel_10', word: 'Panel-Flipping', part: 'adjective' },
      { goal: 50, key: 'graphic_novel_50', word: 'Sidekick', part: 'noun' },
      { goal: 100, key: 'graphic_novel_100', word: 'Superhero', part: 'noun' },
    ],
  },
  {
    group: 'Poetry',
    tags: ['poetry'],
    requirement: (n) => `Read ${n} poetry books`,
    rungs: [
      { goal: 5, key: 'poetry_5', word: 'Rhyming', part: 'adjective' },
      { goal: 10, key: 'poetry_10', word: 'Free-Verse', part: 'adjective' },
      { goal: 50, key: 'poetry_50', word: 'Bard', part: 'noun' },
      { goal: 100, key: 'poetry_100', word: 'Poet Laureate', part: 'noun' },
    ],
  },
  {
    group: 'Philosophy',
    tags: ['philosophy'],
    requirement: (n) => `Read ${n} philosophy books`,
    rungs: [
      { goal: 5, key: 'philosophy_5', word: 'Pondering', part: 'adjective' },
      { goal: 10, key: 'philosophy_10', word: 'Existential', part: 'adjective' },
      { goal: 50, key: 'philosophy_50', word: 'Armchair Philosopher', part: 'noun' },
      { goal: 100, key: 'philosophy_100', word: 'Philosopher King', part: 'noun' },
    ],
  },
  {
    group: 'Popular science',
    tags: ['science'],
    requirement: (n) => `Read ${n} popular science books`,
    rungs: [
      { goal: 5, key: 'science_5', word: 'Nerdy', part: 'adjective' },
      { goal: 10, key: 'science_10', word: 'Peer-Reviewed', part: 'adjective' },
      { goal: 50, key: 'science_50', word: 'Lab Rat', part: 'noun' },
      { goal: 100, key: 'science_100', word: 'Mad Scientist', part: 'noun' },
    ],
  },
  {
    group: 'Indie games',
    tags: ['indie'],
    requirement: (n) => `Play ${n} indie games`,
    rungs: [
      { goal: 5, key: 'indie_5', word: 'Pixelated', part: 'adjective' },
      { goal: 10, key: 'indie_10', word: 'Lo-Fi', part: 'adjective' },
      { goal: 50, key: 'indie_50', word: 'Early Adopter', part: 'noun' },
      { goal: 100, key: 'indie_100', word: 'Indie Darling', part: 'noun' },
    ],
  },
  {
    group: 'Platformers',
    tags: ['platform'],
    requirement: (n) => `Play ${n} platformers`,
    rungs: [
      { goal: 5, key: 'platform_5', word: 'Double-Jumping', part: 'adjective' },
      { goal: 10, key: 'platform_10', word: 'Wall-Jumping', part: 'adjective' },
      { goal: 50, key: 'platform_50', word: 'Plumber', part: 'noun' },
      { goal: 100, key: 'platform_100', word: 'Princess Rescuer', part: 'noun' },
    ],
  },
  {
    group: 'Puzzles & trivia',
    tags: ['puzzle', 'quiz/trivia'],
    requirement: (n) => `Play ${n} puzzle or trivia games`,
    rungs: [
      { goal: 5, key: 'puzzle_5', word: 'Puzzled', part: 'adjective' },
      { goal: 10, key: 'puzzle_10', word: 'Brain-Teased', part: 'adjective' },
      { goal: 50, key: 'puzzle_50', word: 'Quiz Whiz', part: 'noun' },
      { goal: 100, key: 'puzzle_100', word: 'Puzzle Master', part: 'noun' },
    ],
  },
  {
    group: 'Racing',
    tags: ['racing'],
    requirement: (n) => `Play ${n} racing games`,
    rungs: [
      { goal: 5, key: 'racing_5', word: 'Turbo-Charged', part: 'adjective' },
      { goal: 10, key: 'racing_10', word: 'Drifting', part: 'adjective' },
      { goal: 50, key: 'racing_50', word: 'Pit Crew', part: 'noun' },
      { goal: 100, key: 'racing_100', word: 'Speed Demon', part: 'noun' },
    ],
  },
  {
    group: 'Fighting',
    tags: ['fighting', "hack and slash/beat 'em up"],
    requirement: (n) => `Play ${n} fighting or beat 'em up games`,
    rungs: [
      { goal: 5, key: 'fighting_5', word: 'Combo-Breaking', part: 'adjective' },
      { goal: 10, key: 'fighting_10', word: 'Knockout', part: 'adjective' },
      { goal: 50, key: 'fighting_50', word: 'Brawler', part: 'noun' },
      { goal: 100, key: 'fighting_100', word: 'Grand Champion', part: 'noun' },
    ],
  },
  {
    group: 'Sports',
    tags: ['sport'],
    requirement: (n) => `Play ${n} sports games`,
    rungs: [
      { goal: 5, key: 'sport_5', word: 'Sporty', part: 'adjective' },
      { goal: 10, key: 'sport_10', word: 'Benchwarming', part: 'adjective' },
      { goal: 50, key: 'sport_50', word: 'Team Captain', part: 'noun' },
      { goal: 100, key: 'sport_100', word: 'MVP', part: 'noun' },
    ],
  },
  {
    group: 'Strategy',
    tags: ['strategy', 'real time strategy (rts)', 'turn-based strategy (tbs)', 'tactical', 'moba'],
    requirement: (n) => `Play ${n} strategy games`,
    rungs: [
      { goal: 5, key: 'strategy_5', word: 'Calculating', part: 'adjective' },
      { goal: 10, key: 'strategy_10', word: 'Tactical', part: 'adjective' },
      { goal: 50, key: 'strategy_50', word: 'General', part: 'noun' },
      { goal: 100, key: 'strategy_100', word: 'Warlord', part: 'noun' },
    ],
  },
  {
    group: 'Simulators',
    tags: ['simulator'],
    requirement: (n) => `Play ${n} simulators`,
    rungs: [
      { goal: 5, key: 'simulator_5', word: 'Simulated', part: 'adjective' },
      { goal: 10, key: 'simulator_10', word: 'Hyper-Realistic', part: 'adjective' },
      { goal: 50, key: 'simulator_50', word: 'Virtual Farmer', part: 'noun' },
      { goal: 100, key: 'simulator_100', word: 'Sim Overlord', part: 'noun' },
    ],
  },
  {
    group: 'Story games',
    tags: ['point-and-click', 'visual novel'],
    requirement: (n) => `Play ${n} point-and-click games or visual novels`,
    rungs: [
      { goal: 5, key: 'story_5', word: 'Clicking', part: 'adjective' },
      { goal: 10, key: 'story_10', word: 'Branching', part: 'adjective' },
      { goal: 50, key: 'story_50', word: 'Pixel Hunter', part: 'noun' },
      { goal: 100, key: 'story_100', word: 'Plot Devourer', part: 'noun' },
    ],
  },
  {
    group: 'Arcade & tabletop',
    tags: ['arcade', 'pinball', 'card & board game'],
    requirement: (n) => `Play ${n} arcade, pinball or card and board games`,
    rungs: [
      { goal: 5, key: 'arcade_5', word: 'Coin-Operated', part: 'adjective' },
      { goal: 10, key: 'arcade_10', word: 'High-Scoring', part: 'adjective' },
      { goal: 50, key: 'arcade_50', word: 'Card Shark', part: 'noun' },
      { goal: 100, key: 'arcade_100', word: 'Arcade Legend', part: 'noun' },
    ],
  },
]

// Every catalog tag a ladder counts — for the test that each is one a catalog
// really returns.
export const LADDER_TAGS: string[] = GENRE_LADDERS.flatMap((ladder) => ladder.tags ?? [])

// The genre ladders' group names, so the filter can list them as genres.
export const GENRE_GROUPS: ReadonlySet<string> = new Set(GENRE_LADDERS.map((ladder) => ladder.group))

// The same ladder for each medium, counted over everything finished in it. The
// media's original credits sat at 20 or 25; each keeps its key on the rung
// below, which only makes it easier. Films keep a fifth rung at 250.
const MEDIA_LADDERS: Ladder[] = [
  {
    group: 'Films',
    measure: (stats) => consumedOfType(stats, 'movie'),
    requirement: (n) => `Watch ${n} films`,
    rungs: [
      { goal: 5, key: 'films_5', word: 'Popcorn-Fuelled', part: 'adjective' },
      { goal: 10, key: 'films_10', word: 'Big-Screen', part: 'adjective' },
      { goal: 50, key: 'cinephile', word: 'Popcorn Muncher', part: 'noun' },
      { goal: 100, key: 'projectionist', word: 'Projectionist', part: 'noun' },
      { goal: 250, key: 'film_freak', word: 'Cinema Goblin', part: 'noun' },
    ],
  },
  {
    group: 'TV',
    measure: (stats) => consumedOfType(stats, 'tv'),
    requirement: (n) => `Finish ${n} shows`,
    rungs: [
      { goal: 5, key: 'tv_5', word: 'Binge-Watching', part: 'adjective' },
      { goal: 10, key: 'couch_potato', word: 'Couch Potato', part: 'noun' },
      { goal: 50, key: 'tv_50', word: 'Square-Eyed', part: 'adjective' },
      { goal: 100, key: 'tv_100', word: 'Showrunner', part: 'noun' },
    ],
  },
  {
    group: 'Books',
    measure: (stats) => consumedOfType(stats, 'book'),
    requirement: (n) => `Read ${n} books`,
    rungs: [
      { goal: 5, key: 'books_5', word: 'Dog-Eared', part: 'adjective' },
      { goal: 10, key: 'bookworm', word: 'Page-Turner', part: 'noun' },
      { goal: 50, key: 'books_50', word: 'Well-Read', part: 'adjective' },
      { goal: 100, key: 'books_100', word: 'Bookworm', part: 'noun' },
    ],
  },
  {
    group: 'Games',
    measure: (stats) => consumedOfType(stats, 'game'),
    requirement: (n) => `Play ${n} games`,
    rungs: [
      { goal: 5, key: 'games_5', word: 'Player-One', part: 'adjective' },
      { goal: 10, key: 'gamer', word: 'Button Masher', part: 'noun' },
      { goal: 50, key: 'games_50', word: 'Speedrunning', part: 'adjective' },
      { goal: 100, key: 'games_100', word: 'Completionist', part: 'noun' },
    ],
  },
]

// The media ladders' group names, likewise.
export const MEDIA_GROUPS: ReadonlySet<string> = new Set(MEDIA_LADDERS.map((ladder) => ladder.group))

// In the order the Titles tab lists each part's words: the ones most people
// earn first, then taste, then volume, then habits, then the social ones.
//
// The two starter credits lead the list on purpose: a member's first title goes
// on automatically, from the first genre and role unlocked — see
// checkTitleUnlocks — and these are always the first.
export const TITLES: readonly TitleDefinition[] = [
  {
    key: 'newborn',
    group: 'Getting started',
    word: 'Newborn',
    part: 'adjective',
    requirement: 'Join On Deck',
    goal: 0,
    measure: () => 0,
    starter: true,
  },
  {
    key: 'baby',
    group: 'Getting started',
    word: 'Baby',
    part: 'noun',
    requirement: 'Join On Deck',
    goal: 0,
    measure: () => 0,
    starter: true,
  },
  {
    key: 'rookie',
    group: 'Getting started',
    word: 'Background Extra',
    part: 'noun',
    requirement: 'Finish your first anything',
    goal: 1,
    measure: (stats) => stats.consumed.length,
  },
  {
    key: 'opinionated',
    group: 'Getting started',
    word: 'Hot-Take',
    part: 'adjective',
    requirement: 'Rate your first anything',
    goal: 1,
    measure: (stats) => stats.rated,
  },
  ...GENRE_LADDERS.flatMap(ladderCredits),
  ...MEDIA_LADDERS.flatMap(ladderCredits),
  {
    key: 'polymath',
    group: 'Across media',
    word: 'Media Omnivore',
    part: 'noun',
    requirement: 'Finish 5 each of films, shows, books and games',
    goal: 5,
    measure: (stats) =>
      Math.min(...['movie', 'tv', 'book', 'game'].map((type) => consumedOfType(stats, type))),
  },
  {
    key: 'critic',
    group: 'Ratings & notes',
    word: 'Armchair Critic',
    part: 'noun',
    requirement: 'Rate 50 things',
    goal: 50,
    measure: (stats) => stats.rated,
  },
  {
    key: 'superfan',
    group: 'Ratings & notes',
    word: 'Stan',
    part: 'noun',
    requirement: 'Give 25 things five stars',
    goal: 25,
    measure: (stats) => stats.topRated,
  },
  {
    key: 'salty',
    group: 'Ratings & notes',
    word: 'Certified Rotten',
    part: 'adjective',
    requirement: 'Mark 10 things as disliked',
    goal: 10,
    measure: (stats) => stats.disliked,
  },
  {
    key: 'verbose',
    group: 'Ratings & notes',
    word: 'Footnoted',
    part: 'adjective',
    requirement: 'Write notes on 20 things',
    goal: 20,
    measure: (stats) => stats.withNotes,
  },
  {
    key: 'hoarder',
    group: 'Your lists',
    word: 'Watchlist Hoarder',
    part: 'noun',
    requirement: 'Have 30 things on your want-to list',
    goal: 30,
    measure: (stats) => stats.wantToConsume,
  },
  {
    key: 'picky',
    group: 'Your lists',
    word: 'Channel-Flipping',
    part: 'adjective',
    requirement: 'Turn down 20 things as not interested',
    goal: 20,
    measure: (stats) => stats.notInterested,
  },
  {
    key: 'archivist',
    group: 'Imports & picks',
    word: 'VHS Collector',
    part: 'noun',
    requirement: 'Bring 100 entries in from an import or a connected account',
    goal: 100,
    measure: (stats) => stats.imported,
  },
  {
    key: 'curious',
    group: 'Imports & picks',
    word: 'Algorithm-Fed',
    part: 'adjective',
    requirement: 'Get recommendations for films, shows, books and games',
    goal: 4,
    measure: (stats) => new Set(stats.recommendedTypes).size,
  },
  {
    key: 'lucky',
    group: 'Imports & picks',
    word: 'Shuffle-Mode',
    part: 'adjective',
    requirement: "Draw a day's lucky pick",
    goal: 1,
    measure: (stats) => stats.luckyRuns,
  },
  {
    key: 'nosy',
    group: 'Social',
    word: 'Subscribed',
    part: 'adjective',
    requirement: 'Follow 10 people',
    goal: 10,
    measure: (stats) => stats.following,
  },
  {
    key: 'popular',
    group: 'Social',
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

// A choice from the Titles tab, checked against what has been unlocked. An
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
