import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import type { UserLogEntry } from '../app/data/mediaItems.ts'
import { buildExclusions } from '../app/data/recommendations/exclusions.ts'
import { getLuckyState, LUCKY_WINDOW_MS } from '../app/data/recommendations/lucky.ts'
import {
  findUnusedDuplicateRun,
  listRecommendationRuns,
  MAX_RUNS_PER_USER,
  pruneOldRuns,
  saveRun,
} from '../app/data/recommendations/runs.ts'
import type { MediaItem, User, UserMediaInteraction } from '../app/data/schema.ts'
import { skipWithoutDatabase } from './support/db.ts'

// A log row, cut down to the two fields the exclusion rule reads.
function entry(externalId: string, title: string, status: string): UserLogEntry {
  return {
    interaction: { status } as UserMediaInteraction,
    item: { external_id: externalId, title } as MediaItem,
  }
}

// No database and no model client — see exclusions.ts for why the rule lives
// where it can be called like this.
describe('buildExclusions', () => {
  it('excludes what most of the group has finished, on an ordinary run', () => {
    const alice = [entry('tt1', 'Heat', 'consumed'), entry('tt2', 'Ronin', 'consumed')]
    const bob = [entry('tt1', 'Heat', 'consumed')]

    const { externalIds } = buildExclusions([alice, bob])

    assert.ok(externalIds.has('tt1'), 'both have finished it')
    assert.ok(!externalIds.has('tt2'), 'only one of two has finished it, which is under the threshold')
  })

  it('excludes anything anyone has logged at all, on a lucky run', () => {
    const alice = [entry('tt1', 'Heat', 'consumed'), entry('tt2', 'Ronin', 'want_to_consume')]
    const bob = [entry('tt3', 'Collateral', 'in_progress')]

    const { externalIds } = buildExclusions([alice, bob], { lucky: true })

    assert.deepEqual([...externalIds].sort(), ['tt1', 'tt2', 'tt3'])
  })

  it('leaves want-to and in-progress rows alone on an ordinary run', () => {
    const alice = [entry('tt2', 'Ronin', 'want_to_consume'), entry('tt3', 'Collateral', 'in_progress')]

    const { externalIds } = buildExclusions([alice, alice])

    assert.equal(externalIds.size, 0, 'neither is something they have actually seen')
  })

  it('excludes a rejection from anyone, on either kind of run', () => {
    const alice = [entry('tt4', 'Cats', 'not_interested')]
    const bob: UserLogEntry[] = []

    for (const options of [{}, { lucky: true }]) {
      const { externalIds, titles } = buildExclusions([alice, bob], options)
      assert.ok(externalIds.has('tt4'))
      assert.deepEqual(titles.rejected, ['Cats'])
      assert.deepEqual(titles.seen, [], 'a rejection is not something they have seen')
    }
  })

  it('counts one person twice as one person', () => {
    // Two rows for the same title — a re-watch, or a duplicate from an import.
    const alice = [entry('tt1', 'Heat', 'consumed'), entry('tt1', 'Heat', 'consumed')]
    const bob = [entry('tt9', 'Thief', 'consumed')]
    const carol = [entry('tt9', 'Thief', 'consumed')]

    const { externalIds } = buildExclusions([alice, bob, carol])

    assert.ok(!externalIds.has('tt1'), 'one person cannot cross the threshold alone')
    assert.ok(externalIds.has('tt9'))
  })

  it('names each rejected title once, however many people rejected it', () => {
    const alice = [entry('tt4', 'Cats', 'not_interested')]
    const bob = [entry('tt4', 'Cats', 'not_interested')]

    const { titles } = buildExclusions([alice, bob])

    assert.deepEqual(titles.rejected, ['Cats'])
  })
})

// Needs a migrated database: `npm run db:up && npm run db:migrate`.
describe("I'm feeling lucky", { skip: skipWithoutDatabase }, () => {
  let user: User
  let itemId: number

  const newUser = async (tag: string): Promise<User> => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { rows } = await pool.query<User>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1,'x',$2,$3) returning *`,
      [`lucky-${tag}-${stamp}@example.test`, `lucky-${tag}-${stamp}`, Date.now()],
    )
    return rows[0]
  }

  // Saved directly rather than generated: the pipeline in between wants a model,
  // and what is under test here is the bookkeeping around the run it produces.
  const saveLuckyRun = async (owner: User, createdAt: number, mediaType = 'movie' as const) => {
    const runId = await saveRun(db, {
      requestingUserId: owner.id,
      memberUserIds: [owner.id],
      mediaType,
      name: 'Lucky pick',
      params: { sourceTypes: [mediaType] },
      results: [{ item: { id: itemId } as never, reason: 'Because it is good.', interaction: null }],
      lucky: true,
    })
    await pool.query(`update recommendation_runs set created_at = $1 where id = $2`, [createdAt, runId])
    return runId
  }

  before(async () => {
    user = await newUser('owner')
    const { rows } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie','test',$1,'Fixture Film','{"releaseYear":1995}'::jsonb,$2) returning id`,
      [`lucky-item-${Date.now()}-${Math.random()}`, Date.now()],
    )
    itemId = rows[0].id
  })

  it('offers a draw when none has been made', async () => {
    const state = await getLuckyState(user)

    assert.equal(state.pick, null)
    assert.equal(state.available, true)
    assert.equal(state.nextAt, null)
  })

  it('reports the pick, and refuses a second draw, inside the window', async () => {
    const drawnAt = Date.now() - 60_000
    const runId = await saveLuckyRun(user, drawnAt)

    const state = await getLuckyState(user)

    assert.equal(state.available, false)
    assert.equal(state.nextAt, drawnAt + LUCKY_WINDOW_MS)
    assert.equal(state.pick?.runId, runId)
    assert.equal(state.pick?.title, 'Fixture Film')
    assert.equal(state.pick?.reason, 'Because it is good.')
    assert.deepEqual(state.pick?.otherMemberLabels, [], 'drawn alone')
  })

  it('frees the draw again once the window has passed', async () => {
    const stale = await newUser('stale')
    await saveLuckyRun(stale, Date.now() - LUCKY_WINDOW_MS - 60_000)

    const state = await getLuckyState(stale)

    assert.equal(state.pick, null, 'yesterday is not today')
    assert.equal(state.available, true)
  })

  it('exempts admins, the way the run and rebuild caps do', async () => {
    const admin = await newUser('admin')
    await pool.query(`update users set is_admin = true where id = $1`, [admin.id])
    await saveLuckyRun({ ...admin, is_admin: true }, Date.now())

    const state = await getLuckyState({ ...admin, is_admin: true })

    assert.equal(state.available, true)
    assert.ok(state.pick, 'still shows what they last drew')
    assert.equal(state.nextAt, null)
  })

  it('does not spend the draw on an ordinary run', async () => {
    const other = await newUser('ordinary')
    await saveRun(db, {
      requestingUserId: other.id,
      memberUserIds: [other.id],
      mediaType: 'movie',
      params: { sourceTypes: ['movie'] },
      results: [{ item: { id: itemId } as never, reason: 'r', interaction: null }],
    })

    const state = await getLuckyState(other)

    assert.equal(state.available, true)
    assert.equal(state.pick, null)
  })

  it('does not spend the draw on a run that came back with nothing', async () => {
    const empty = await newUser('empty')
    await saveRun(db, {
      requestingUserId: empty.id,
      memberUserIds: [empty.id],
      mediaType: 'movie',
      name: 'Lucky pick',
      params: { sourceTypes: ['movie'] },
      results: [],
      lucky: true,
    })

    const state = await getLuckyState(empty)

    assert.equal(state.available, true, 'there is nothing to show for it, so it cannot be today’s pick')
    assert.equal(state.pick, null)
  })

  it("keeps today's pick when ordinary runs fill the cap", async () => {
    const busy = await newUser('busy')
    const luckyRunId = await saveLuckyRun(busy, Date.now())

    // One more than the cap, so pruning definitely runs.
    for (let i = 0; i <= MAX_RUNS_PER_USER; i++) {
      await saveRun(db, {
        requestingUserId: busy.id,
        memberUserIds: [busy.id],
        mediaType: 'movie',
        params: { sourceTypes: ['movie'] },
        results: [{ item: { id: itemId } as never, reason: 'r', interaction: null }],
      })
      await pruneOldRuns(db, busy.id, 'movie')
    }

    const kept = await listRecommendationRuns(db, busy.id, 'movie')
    assert.equal(kept.filter((run) => !run.isLucky).length, MAX_RUNS_PER_USER)
    assert.ok(
      kept.some((run) => run.id === luckyRunId),
      "the day's pick survived a full cap of ordinary runs",
    )

    const state = await getLuckyState(busy)
    assert.equal(state.pick?.runId, luckyRunId)
  })

  it('never offers a lucky run as the duplicate of an ordinary one', async () => {
    const dup = await newUser('dup')
    await saveLuckyRun(dup, Date.now())

    // Same shape a lucky run has: solo, one source, no filters.
    const duplicate = await findUnusedDuplicateRun(db, dup.id, [dup.id], 'movie', {}, ['movie'])

    assert.equal(duplicate, null)
  })
})
