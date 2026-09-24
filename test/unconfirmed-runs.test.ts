import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  getUnconfirmedRun,
  listUnconfirmedRuns,
  MAX_UNCONFIRMED_PER_USER,
  saveUnconfirmedRun,
} from '../app/data/recommendations/unconfirmed.ts'
import { skipWithoutDatabase } from './support/db.ts'

// What the model answered when the catalog wouldn't. These rows hold the picks as
// JSON rather than pointing at catalog entries, which is the whole reason they are
// a table of their own.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe('unconfirmed runs', { skip: skipWithoutDatabase }, () => {
  let userId: number
  let otherId: number

  const newUser = async (tag: string) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const {
      rows: [user],
    } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1, 'x', $2, $3) returning id`,
      [`unconfirmed-${tag}-${stamp}@example.com`, `unconfirmed ${tag} ${stamp}`, Date.now()],
    )
    return user.id
  }

  const pick = (title: string) => ({ title, year: 1999, reason: `because ${title}` })

  const save = (id: number, titles: string[]) =>
    saveUnconfirmedRun(db, {
      userId: id,
      mediaType: 'book',
      filters: { genre: 'romance' },
      picks: titles.map(pick),
      reason: "the catalog isn't answering right now",
    })

  before(async () => {
    userId = await newUser('owner')
    otherId = await newUser('other')
  })

  after(async () => {
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
})
