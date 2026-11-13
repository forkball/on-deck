import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  authorSurnameKey,
  collapseEditions,
  editionKey,
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
  return { id, title, creator, hasCover: true, logged: false, ...extra }
}

const ids = (results: Result[]) => collapseEditions(results, (r) => r).map((r) => r.id)

describe('editionKey', () => {
  // The three Baltimore results a search for it actually returned.
  it('reads the printings of one book as one', () => {
    const volumeOne = editionKey('Baltimore Volume I: The Plague Ships', 'Mike Mignola')
    assert.equal(editionKey('Baltimore: The Plague Ships', 'Michael Mignola'), volumeOne)
    assert.equal(editionKey('Baltimore, Vol. 1: The Plague Ships', 'Mike Mignola'), volumeOne)
  })

  it('keeps a sequel apart, though its title holds the first one', () => {
    assert.notEqual(editionKey('Dune', 'Frank Herbert'), editionKey('Dune Messiah', 'Frank Herbert'))
  })

  it('keeps later volumes apart', () => {
    assert.notEqual(
      editionKey('Saga Volume 1', 'Brian K. Vaughan'),
      editionKey('Saga Volume 2', 'Brian K. Vaughan'),
    )
  })

  it('keeps one title by two authors apart', () => {
    assert.notEqual(editionKey('Rebecca', 'Daphne du Maurier'), editionKey('Rebecca', 'Someone Else'))
  })

  it('drops "a novel"', () => {
    assert.equal(
      editionKey('The Goldfinch: A Novel', 'Donna Tartt'),
      editionKey('The Goldfinch', 'Donna Tartt'),
    )
  })

  it('is empty without an author, so nothing is merged on a title alone', () => {
    assert.equal(editionKey('Rebecca', null), '')
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
      entry.kind === 'single' ? entry.result : `${entry.series}: [${entry.issues.join(' | ')}]`,
    )

  // What a search for Baltimore actually returned, issues credited to whichever
  // writer Google picked, ahead of the collected book.
  it('gathers a series into one entry where its first issue sat, in number order', () => {
    assert.deepEqual(
      shape([
        'Baltimore: The Plague Ships #3',
        'Baltimore: The Plague Ships #5',
        'Baltimore Volume I: The Plague Ships',
        'Baltimore: The Plague Ships #1',
      ]),
      [
        'Baltimore: The Plague Ships: [Baltimore: The Plague Ships #1 | Baltimore: The Plague Ships #3 | Baltimore: The Plague Ships #5]',
        'Baltimore Volume I: The Plague Ships',
      ],
    )
  })

  it('leaves a lone issue as an ordinary result', () => {
    assert.deepEqual(shape(['Saga #1', 'Saga Volume 1']), ['Saga #1', 'Saga Volume 1'])
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
