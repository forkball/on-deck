import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  arrangeBookResults,
  authorSurnameKey,
  collapseEditions,
  editionTitleKey,
  groupSingleIssues,
  parseIssue,
  type EditionFacts,
} from '../app/data/catalog/editions.ts'

interface Result extends EditionFacts {
  id: number
}

function result(
  id: number,
  title: string,
  creator: string | null,
  extra: Partial<EditionFacts> = {},
): Result {
  return { id, title, creators: creator ? [creator] : [], hasCover: true, logged: false, ...extra }
}

const ids = (results: Result[]) => collapseEditions(results, (r) => r).map((r) => r.id)

// Whether two results, each a title and its author, show as one book.
const sameBook = ([titleA, authorA]: [string, string], [titleB, authorB]: [string, string]) =>
  ids([result(1, titleA, authorA), result(2, titleB, authorB)]).length === 1

describe('which results are one book', () => {
  // The three Baltimore results a search for it actually returned.
  it('reads the printings of one book as one', () => {
    const volumeOne: [string, string] = ['Baltimore Volume I: The Plague Ships', 'Mike Mignola']
    assert.ok(sameBook(['Baltimore: The Plague Ships', 'Michael Mignola'], volumeOne))
    assert.ok(sameBook(['Baltimore, Vol. 1: The Plague Ships', 'Mike Mignola'], volumeOne))
  })

  it('keeps a sequel apart, though its title holds the first one', () => {
    assert.ok(!sameBook(['Dune', 'Frank Herbert'], ['Dune Messiah', 'Frank Herbert']))
  })

  it('keeps later volumes apart', () => {
    assert.ok(!sameBook(['Saga Volume 1', 'Brian K. Vaughan'], ['Saga Volume 2', 'Brian K. Vaughan']))
  })

  it('keeps one title by two authors apart', () => {
    assert.ok(!sameBook(['Rebecca', 'Daphne du Maurier'], ['Rebecca', 'Someone Else']))
  })

  it('drops "a novel"', () => {
    assert.ok(sameBook(['The Goldfinch: A Novel', 'Donna Tartt'], ['The Goldfinch', 'Donna Tartt']))
  })
})

describe('authorSurnameKey', () => {
  it('ignores initials spacing and a suffix', () => {
    assert.equal(authorSurnameKey('J.R.R. Tolkien'), authorSurnameKey('J. R. R. Tolkien'))
    assert.equal(authorSurnameKey('Harry Turtledove Jr.'), 'turtledove')
  })
})

describe('collapseEditions', () => {
  it('shows one card per book, where its best-ranked edition sat', () => {
    assert.deepEqual(
      ids([
        result(1, 'Baltimore: The Plague Ships', 'Michael Mignola'),
        result(2, 'Hellboy', 'Mike Mignola'),
        result(3, 'Baltimore Volume I: The Plague Ships', 'Mike Mignola'),
      ]),
      [1, 2],
    )
  })

  it('keeps the edition the person logged', () => {
    assert.deepEqual(
      ids([
        result(1, 'Baltimore: The Plague Ships', 'Michael Mignola'),
        result(2, 'Baltimore Volume I: The Plague Ships', 'Mike Mignola', { logged: true }),
      ]),
      [2],
    )
  })

  it('prefers an edition with a cover over a better-ranked one without', () => {
    assert.deepEqual(
      ids([
        result(1, 'Baltimore: The Plague Ships', 'Michael Mignola', { hasCover: false }),
        result(2, 'Baltimore Volume I: The Plague Ships', 'Mike Mignola'),
        result(3, 'Baltimore Volume I: The Plague Ships', 'Mike Mignola'),
      ]),
      [2],
    )
  })

  it('leaves results without an author alone', () => {
    assert.deepEqual(ids([result(1, 'Rebecca', null), result(2, 'Rebecca', null)]), [1, 2])
  })
})

describe('parseIssue', () => {
  it('reads a trailing issue number', () => {
    assert.deepEqual(parseIssue('Baltimore: The Plague Ships #3'), {
      series: 'Baltimore: The Plague Ships',
      number: 3,
      run: null,
    })
    assert.deepEqual(parseIssue('Saga Issue 12'), { series: 'Saga', number: 12, run: null })
    assert.deepEqual(parseIssue('Hellboy: Seed of Destruction #1 (of 4)'), {
      series: 'Hellboy: Seed of Destruction',
      number: 1,
      run: null,
    })
  })

  it('leaves a number that is part of the name alone', () => {
    assert.equal(parseIssue('Fahrenheit 451'), null)
    assert.equal(parseIssue('Saga Volume 2'), null)
    assert.equal(parseIssue('#1 Fan'), null)
  })
})

describe('groupSingleIssues', () => {
  // Comics unless a test says otherwise: the title rule is what most cases test.
  const shape = (titles: string[], notComics: string[] = []) =>
    groupSingleIssues(titles, (title) => ({ title, comic: !notComics.includes(title) })).map((entry) =>
      entry.kind === 'single'
        ? entry.issues
          ? `${entry.result} < [${entry.issues.join(' | ')}]`
          : entry.result
        : `${entry.series}: [${entry.issues.join(' | ')}]`,
    )

  // What a search for Baltimore actually returned: issues credited to whichever
  // writer Google picked, ahead of the collected book that binds them.
  it('lists the issues under their collected edition, where the better-ranked sat', () => {
    assert.deepEqual(
      shape([
        'Baltimore: The Plague Ships #3',
        'Baltimore: The Plague Ships #5',
        'Hellboy',
        'Baltimore Volume I: The Plague Ships',
        'Baltimore: The Plague Ships #1',
      ]),
      [
        'Baltimore Volume I: The Plague Ships < [Baltimore: The Plague Ships #1 | Baltimore: The Plague Ships #3 | Baltimore: The Plague Ships #5]',
        'Hellboy',
      ],
    )
  })

  it('gathers issues into an entry of their own when no collected edition came back', () => {
    assert.deepEqual(shape(['Saga #3', 'Paper Girls', 'Saga #1']), [
      'Saga: [Saga #1 | Saga #3]',
      'Paper Girls',
    ])
  })

  it('puts a lone issue under its collected edition', () => {
    assert.deepEqual(shape(['Saga #1', 'Saga Volume 1']), ['Saga Volume 1 < [Saga #1]'])
  })

  it('leaves a lone issue with no collected edition as an ordinary result', () => {
    assert.deepEqual(shape(['Saga #1', 'Paper Girls']), ['Saga #1', 'Paper Girls'])
  })

  it('does not take a novel of the same name as the collected edition', () => {
    assert.deepEqual(shape(['Saga #1', 'Saga #2', 'Saga'], ['Saga']), ['Saga: [Saga #1 | Saga #2]', 'Saga'])
  })

  it('keeps two series apart', () => {
    assert.deepEqual(shape(['Saga #1', 'Paper Girls #1', 'Saga #2', 'Paper Girls #2']), [
      'Saga: [Saga #1 | Saga #2]',
      'Paper Girls: [Paper Girls #1 | Paper Girls #2]',
    ])
  })

  it('leaves numbered novels alone, which the title pattern also fits', () => {
    const goosebumps = ['Goosebumps #1', 'Goosebumps #2']
    assert.deepEqual(shape(goosebumps, goosebumps), goosebumps)
  })

  it('groups only the issues tagged as comics', () => {
    assert.deepEqual(shape(['Saga #1', 'Saga #2', 'Saga #3'], ['Saga #3']), [
      'Saga: [Saga #1 | Saga #2]',
      'Saga #3',
    ])
  })
})

// An anthology's printings each credit a different contributor first, so the
// first name alone kept them apart; the full credit list joins them.
describe('collapseEditions across full credit lists', () => {
  it("joins an anthology's printings that share any contributor", () => {
    assert.deepEqual(
      ids([
        result(1, 'Creepshow Volume 1', 'Chris Burnham', {
          creators: ['Chris Burnham', 'Paul Dini', 'Joe Hill'],
          logged: true,
        }),
        result(2, 'Creepshow, volume 1', 'Paul Dini', { creators: ['Paul Dini', 'Stephen Langford'] }),
      ]),
      [1],
    )
  })

  it('joins printings that overlap only through a third', () => {
    assert.deepEqual(
      ids([
        result(1, 'Creepshow Volume 1', 'Chris Burnham', { creators: ['Chris Burnham', 'Paul Dini'] }),
        result(2, 'Creepshow Volume 1', 'Paul Dini', { creators: ['Paul Dini', 'Joe Hill'] }),
        result(3, 'Creepshow Volume 1', 'Joe Hill', { creators: ['Joe Hill'] }),
      ]),
      [1],
    )
  })

  it('keeps different books of one name apart when no one is credited on both', () => {
    assert.deepEqual(
      ids([
        result(1, 'Batman Volume 1', 'Scott Snyder', { creators: ['Scott Snyder', 'Greg Capullo'] }),
        result(2, 'Batman Volume 1', 'Tom King', { creators: ['Tom King', 'David Finch'] }),
      ]),
      [1, 2],
    )
  })

  it('keeps an edition credited only as "various authors" apart', () => {
    assert.deepEqual(
      ids([
        result(1, 'Creepshow vol. 1', 'AA.VV.', { creators: ['AA.VV.'] }),
        result(2, 'Creepshow Volume 1', 'Chris Burnham', { creators: ['Chris Burnham', 'Paul Dini'] }),
      ]),
      [1, 2],
    )
  })
})

// What a search for "The Long Halloween" returned: ten cards for five works.
// Run through the same call the search page makes.
describe('the Long Halloween search', () => {
  interface Hit {
    title: string
    creator: string | null
    comic: boolean
    logged?: boolean
    cover?: boolean
  }
  const hit = (title: string, creator: string | null = 'Jeph Loeb', extra: Partial<Hit> = {}): Hit => ({
    title,
    creator,
    comic: true,
    ...extra,
  })

  const hits: Hit[] = [
    hit('Batman: The Long Halloween', 'Jeph Loeb', { logged: true }),
    hit('Batman: The Long Halloween #1'),
    hit('Batman Noir: The Long Halloween'),
    hit('Batman: The Long Halloween Special (2021) #1'),
    hit('Batman The Long Halloween: The Last Halloween (2024-) #1'),
    hit('Batman The Long Halloween: The Last Halloween (2024-) #2'),
    hit('Batman: The Long Halloween', null, { comic: false, cover: false }),
    hit('Batman: The Long Halloween Deluxe Edition'),
    hit('Batman The Long Halloween: The Last Halloween'),
    hit('Batman The Long Halloween Deluxe Edition The Sequel: Dark Victory'),
    hit('Batman The Long Halloween: The Last Halloween Noir Edition (2024-) #1'),
    hit('Batman: The Long Halloween Deluxe Edition The Prequel: Haunted Knight'),
    hit('Batman: The Long Halloween #2'),
  ]

  it('shows one card per work, with the issues under the book that collects them', () => {
    const entries = arrangeBookResults(hits, (h) => ({
      title: h.title,
      creators: h.creator ? [h.creator] : [],
      hasCover: h.cover ?? true,
      logged: h.logged ?? false,
      comic: h.comic,
    }))
    const shown = entries.map((entry) =>
      entry.kind === 'single'
        ? entry.issues
          ? `${entry.result.title} < ${entry.issues.length} issues`
          : entry.result.title
        : `${entry.series}: ${entry.issues.length} issues`,
    )
    assert.deepEqual(shown, [
      'Batman: The Long Halloween < 2 issues',
      'Batman: The Long Halloween Special (2021) #1',
      // #1, #2 — the Noir Edition's #1 is the same issue repackaged, so one.
      'Batman The Long Halloween: The Last Halloween < 2 issues',
      'Batman The Long Halloween Deluxe Edition The Sequel: Dark Victory',
      'Batman: The Long Halloween Deluxe Edition The Prequel: Haunted Knight',
    ])
    // The card kept is the one logged, not a repackaging of it.
    assert.equal(entries[0]!.kind === 'single' && entries[0]!.result.logged, true)
  })
})

describe('edition title rules', () => {
  it('reads packaging as the same book', () => {
    const plain = editionTitleKey('Batman: The Long Halloween')
    assert.equal(editionTitleKey('Batman Noir: The Long Halloween'), plain)
    assert.equal(editionTitleKey('Batman: The Long Halloween Deluxe Edition'), plain)
    assert.equal(editionTitleKey('Batman: The Long Halloween 30th Anniversary Edition'), plain)
    assert.equal(editionTitleKey('Animal Pound Pen & Ink'), editionTitleKey('Animal Pound'))
  })

  it('reads a store year tag as part of no title', () => {
    assert.equal(editionTitleKey('The Last Halloween (2024-)'), editionTitleKey('The Last Halloween'))
    assert.deepEqual(parseIssue('Batman The Long Halloween: The Last Halloween (2024-) #3'), {
      series: 'Batman The Long Halloween: The Last Halloween',
      number: 3,
      // Kept apart from the title: it is what tells one run from the next.
      run: { start: 2024, end: null },
    })
  })

  it('keeps a sequel and a one-shot apart', () => {
    const plain = editionTitleKey('Batman: The Long Halloween')
    assert.notEqual(editionTitleKey('Batman: The Long Halloween Special'), plain)
    assert.notEqual(
      editionTitleKey('Batman The Long Halloween Deluxe Edition The Sequel: Dark Victory'),
      plain,
    )
  })

  it('leaves an authorless result alone when two books share its title', () => {
    assert.deepEqual(
      ids([
        result(1, 'Batman Volume 1', 'Scott Snyder'),
        result(2, 'Batman Volume 1', 'Tom King'),
        result(3, 'Batman Volume 1', null, { hasCover: false }),
      ]),
      [1, 2, 3],
    )
  })
})

describe('the Animal Pound search', () => {
  // As Google Books ranked them: the black-and-white reprint of #1 ahead of #1
  // itself, and no collected edition at all.
  const titles = [
    'Annually. US Privatization Programs and Regulations Handbook',
    'Animal Pound Pen & Ink #1',
    'Animal Pound #1',
    'Animal Pound #2',
    'Animal Pound #3',
  ]
  const entries = arrangeBookResults(titles, (title) => ({
    title,
    creators: title.startsWith('Animal') ? ['Tom King'] : [],
    hasCover: true,
    logged: false,
    comic: title.startsWith('Animal'),
  }))

  it('gathers the reprint with the issues, named after the plain ones', () => {
    assert.deepEqual(entries[1], {
      kind: 'issues',
      series: 'Animal Pound',
      // The plain #1 kept over its reprint, though the reprint ranked higher.
      issues: ['Animal Pound #1', 'Animal Pound #2', 'Animal Pound #3'],
      split: false,
    })
    assert.equal(entries.length, 2)
  })
})

describe('the runs of a series', () => {
  interface Hit {
    title: string
    creator?: string
    year?: number
    comic?: boolean
  }
  const arrange = (hits: Hit[]) =>
    arrangeBookResults(hits, (h) => ({
      title: h.title,
      creators: [h.creator ?? 'Tom King'],
      hasCover: true,
      logged: false,
      comic: h.comic ?? true,
      year: h.year ?? null,
    }))
  const shown = (hits: Hit[]) =>
    arrange(hits).map((entry) =>
      entry.kind === 'single'
        ? entry.issues
          ? `${entry.result.title} < ${entry.issues.map((i) => i.title).join(', ')}`
          : entry.result.title
        : `${entry.series}: ${entry.issues.map((i) => i.title).join(', ')}`,
    )

  it("keeps two runs of one title apart, by the store's year tag", () => {
    assert.deepEqual(
      shown([
        { title: 'Batman (2016-) #1' },
        { title: 'Batman (2011-2016) #1', creator: 'Scott Snyder' },
        { title: 'Batman (2016-) #2' },
        { title: 'Batman (2011-2016) #2', creator: 'Scott Snyder' },
      ]),
      [
        'Batman (2016–): Batman (2016-) #1, Batman (2016-) #2',
        'Batman (2011–2016): Batman (2011-2016) #1, Batman (2011-2016) #2',
      ],
    )
  })

  it('does not fold two runs\' #1s into one, though one writer is on both', () => {
    assert.deepEqual(
      shown([{ title: 'Batman (2016-) #1' }, { title: 'Batman (2011-2016) #1' }]),
      ['Batman (2016-) #1', 'Batman (2011-2016) #1'],
    )
  })

  it('puts an untagged issue in the run whose years hold it', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman (2016-) #1' },
        { title: 'Batman (2011-2016) #1', creator: 'Scott Snyder' },
        { title: 'Batman #40', year: 2018 },
        { title: 'Batman #12', creator: 'Scott Snyder', year: 2012 },
      ]),
      [
        'Batman (2016–): Batman (2016-) #1, Batman #40',
        'Batman (2011–2016): Batman (2011-2016) #1, Batman #12',
      ],
    )
  })

  it('groups an untagged issue no run holds by its title alone', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman (2016-) #1' },
        { title: 'Batman (2016-) #2' },
        { title: 'Batman #400', year: 1986 },
        { title: 'Batman #401', year: 1986 },
      ]),
      ['Batman (2016–): Batman (2016-) #1, Batman (2016-) #2', 'Batman: Batman #400, Batman #401'],
    )
  })

  it('puts a collected volume under the run that had begun by its year', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman Vol. 1', year: 2017, comic: true },
        { title: 'Batman (2016-) #1' },
        { title: 'Batman (2011-2016) #1', creator: 'Scott Snyder' },
        { title: 'Batman (2016-) #2' },
        { title: 'Batman (2011-2016) #2', creator: 'Scott Snyder' },
      ]),
      [
        'Batman Vol. 1 < Batman (2016-) #1, Batman (2016-) #2',
        'Batman (2011–2016): Batman (2011-2016) #1, Batman (2011-2016) #2',
      ],
    )
  })
})

describe('two untagged runs of one title', () => {
  interface Hit {
    title: string
    creators: string[]
    year?: number
    comic?: boolean
  }
  const arrange = (hits: Hit[]) =>
    arrangeBookResults(hits, (h) => ({
      title: h.title,
      creators: h.creators,
      hasCover: true,
      logged: false,
      comic: h.comic ?? true,
      year: h.year ?? null,
    }))
  const shown = (hits: Hit[]) =>
    arrange(hits).map((entry) =>
      entry.kind === 'single'
        ? entry.issues
          ? `${entry.result.title} < ${entry.issues.map((i) => i.title).join(', ')}`
          : entry.result.title
        : `${entry.split ? 'split ' : ''}${entry.series}: ${entry.issues.map((i) => i.title).join(', ')}`,
    )
  const snyder = ['Scott Snyder', 'Greg Capullo']
  const king = ['Tom King', 'David Finch']

  it('parts them by who made them when an issue number turns up twice', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman #1', creators: king },
        { title: 'Batman #1', creators: snyder },
        { title: 'Batman #2', creators: ['Greg Capullo'] },
        // Joined to King's through Finch, though King isn't credited.
        { title: 'Batman #2', creators: ['David Finch', 'Mikel Janin'] },
      ]),
      ['split Batman: Batman #1, Batman #2', 'split Batman: Batman #1, Batman #2'],
    )
    const [kings] = arrange([
      { title: 'Batman #1', creators: king },
      { title: 'Batman #1', creators: snyder },
      { title: 'Batman #2', creators: ['David Finch'] },
    ])
    assert.deepEqual(kings!.kind === 'issues' && kings!.issues.map((i) => i.creators), [king, ['David Finch']])
  })

  it('leaves one run whole, however its credits disagree, while no number repeats', () => {
    assert.deepEqual(
      shown([
        { title: 'Baltimore: The Plague Ships #1', creators: ['Christopher Golden'] },
        { title: 'Baltimore: The Plague Ships #2', creators: ['Mike Mignola'] },
      ]),
      ['Baltimore: The Plague Ships: Baltimore: The Plague Ships #1, Baltimore: The Plague Ships #2'],
    )
  })

  it('reads a repeated number that shares a credit as one issue printed twice', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman #1', creators: ['Tom King'] },
        { title: 'Batman #1', creators: ['Tom King', 'Mikel Janin'], year: 2017 },
      ]).length,
      1,
    )
  })

  it('puts a collected volume under the run it shares a credit with', () => {
    assert.deepEqual(
      shown([
        { title: 'Batman #1', creators: king },
        { title: 'Batman #1', creators: snyder },
        { title: 'Batman #2', creators: king },
        { title: 'Batman #2', creators: snyder },
        { title: 'Batman Vol. 1', creators: ['Scott Snyder'] },
      ]),
      ['split Batman: Batman #1, Batman #2', 'Batman Vol. 1 < Batman #1, Batman #2'],
    )
  })
})
