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
    })
    assert.deepEqual(parseIssue('Saga Issue 12'), { series: 'Saga', number: 12 })
    assert.deepEqual(parseIssue('Hellboy: Seed of Destruction #1 (of 4)'), {
      series: 'Hellboy: Seed of Destruction',
      number: 1,
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
