import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  getUnconfirmedRun,
  listUnconfirmedRuns,
  MAX_UNCONFIRMED_PER_USER,
  picksToKeepUnconfirmed,
  saveUnconfirmedRun,
} from '../app/data/recommendations/unconfirmed.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

// No database: which picks survive is decided before anything is written.
describe('picksToKeepUnconfirmed', () => {
  const picks = ['First', 'Second', 'Third'].map((title) => ({ title, year: 2000, reason: '' }))
  const nothingLogged = { seen: [], rejected: [] }

  it('keeps every pick of an ordinary run', () => {
    assert.deepEqual(picksToKeepUnconfirmed(picks, { lucky: false, excluded: nothingLogged }), picks)
  })

  // A lucky draw asks for a dozen so the gates have something to drop. Kept
  // whole, an outage turned "one pick" into a page of twelve.
  it('keeps only the top-ranked pick of a lucky draw', () => {
    assert.deepEqual(picksToKeepUnconfirmed(picks, { lucky: true, excluded: nothingLogged }), [picks[0]])
  })

  // No catalog id to filter on during an outage, so the title is compared.
  it('leaves out what has been seen or turned down, by title', () => {
    const kept = picksToKeepUnconfirmed(picks, {
      lucky: false,
      excluded: { seen: ['first'], rejected: ['THIRD'] },
    })
    assert.deepEqual(
      kept.map((pick) => pick.title),
      ['Second'],
    )
  })

  it("draws the lucky pick from what's left, not the model's first answer", () => {
    const kept = picksToKeepUnconfirmed(picks, { lucky: true, excluded: { seen: ['First'], rejected: [] } })
    assert.deepEqual(
      kept.map((pick) => pick.title),
      ['Second'],
    )
  })

  it('keeps nothing when every pick is already logged', () => {
    const excluded = { seen: ['First', 'Second', 'Third'], rejected: [] }
    assert.deepEqual(picksToKeepUnconfirmed(picks, { lucky: true, excluded }), [])
  })
})

// What the model answered when the catalog wouldn't. These rows hold the picks as
// JSON rather than pointing at catalog entries, which is the whole reason they are
// a table of their own.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('unconfirmed runs', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let otherId: number

  const pick = (title: string) => ({ title, year: 1999, reason: `because ${title}` })

  const save = (id: number, titles: string[]) =>
    saveUnconfirmedRun(db, {
      userId: id,
      mediaType: 'book',
      filters: { genre: 'romance' },
      picks: titles.map(pick),
      reason: "the catalog isn't answering right now",
    })

  // Every user this file makes, so `after` can take them back out — these rows
  // share a database with the rest of the suite.
  const created: number[] = []
  const newUser = async (tag: string) => {
    const id = await insertUser(`unconfirmed-${tag}`)
    created.push(id)
    return id
  }

  before(async () => {
    userId = await newUser('owner')
    otherId = await newUser('other')
  })

  after(async () => {
    await pool.query('delete from unconfirmed_runs where user_id = any($1)', [created])
    await deleteUsers(created)
    await pool.end()
  })

  it('keeps the picks and the filters they were made under', async () => {
    const id = await save(userId, ['Persuasion', 'Middlemarch'])
    const run = await getUnconfirmedRun(db, id, userId)

    assert.equal(run?.mediaType, 'book')
    assert.deepEqual(run?.filters, { genre: 'romance' })
    assert.deepEqual(
      run?.picks.map((p) => p.title),
      ['Persuasion', 'Middlemarch'],
    )
    assert.match(run?.reason ?? '', /isn't answering/)
  })

  it("will not hand one person another's", async () => {
    const id = await save(userId, ['Persuasion'])
    assert.equal(await getUnconfirmedRun(db, id, otherId), null)
  })

  it('keeps only the most recent few, newest first', async () => {
    const fresh = await newUser('pruned')
    for (const title of ['first', 'second', 'third', 'fourth', 'fifth']) {
      await save(fresh, [title])
      // Ordering is by created_at, which is milliseconds — without this the
      // last three would tie and the assertion would be about insertion order.
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    const runs = await listUnconfirmedRuns(db, fresh)
    assert.equal(runs.length, MAX_UNCONFIRMED_PER_USER)
    assert.deepEqual(
      runs.map((run) => run.picks[0].title),
      ['fifth', 'fourth', 'third'],
    )
  })

  it('reads a malformed row as empty rather than throwing on the page', async () => {
    const id = await save(userId, ['Persuasion'])
    await pool.query(`update unconfirmed_runs set picks = 'not json' where id = $1`, [id])

    assert.deepEqual((await getUnconfirmedRun(db, id, userId))?.picks, [])
  })

  // The page lays a lucky draw out as the lucky pick, which it can only do if
  // the row says that is what it was.
  it('remembers whether it was a lucky draw', async () => {
    const plain = await save(userId, ['Persuasion'])
    const lucky = await saveUnconfirmedRun(db, {
      userId,
      mediaType: 'movie',
      filters: {},
      picks: [pick('Aftersun')],
      reason: "the catalog isn't answering right now",
      lucky: true,
    })

    assert.equal((await getUnconfirmedRun(db, plain, userId))?.isLucky, false)
    assert.equal((await getUnconfirmedRun(db, lucky, userId))?.isLucky, true)
  })
})
