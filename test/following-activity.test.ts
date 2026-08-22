import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import { followUser } from '../app/data/follows.ts'
import { listFollowingLogActivity } from '../app/data/mediaItems.ts'

// The home page's feed. What it must not show is the point: a stranger's log,
// or a rejection from someone you do follow. Both are decided in SQL, so both
// are asserted against a real database.
//
// Needs a migrated database: `npm run db:up && npm run db:migrate`.
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run (npm run db:up && npm run db:migrate)'

describe('following log activity', { skip }, () => {
  let viewer: number
  let friend: number
  let stranger: number
  const itemIds: number[] = []

  const newUser = async (tag: string) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { rows: [u] } = await pool.query<{ id: number }>(
      `insert into users (email, password_hash, display_name, created_at)
       values ($1,'x',$2,$3) returning id`,
      [`feed-${tag}-${stamp}@example.test`, `feed-${tag}-${stamp}`, Date.now()],
    )
    return u.id
  }

  const newItem = async (title: string) => {
    const { rows: [item] } = await pool.query<{ id: number }>(
      `insert into media_items (type, external_source, external_id, title, metadata, created_at)
       values ('movie','test',$1,$2,'{}'::jsonb,$3) returning id`,
      [`feed-${title}-${Date.now()}-${Math.random()}`, title, Date.now()],
    )
    itemIds.push(item.id)
    return item.id
  }

  const log = (userId: number, itemId: number, status: string, updatedAt: number) =>
    pool.query(
      `insert into user_media_interactions (user_id, media_item_id, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5)`,
      [userId, itemId, status, updatedAt, updatedAt],
    )

  before(async () => {
    viewer = await newUser('viewer')
    friend = await newUser('friend')
    stranger = await newUser('stranger')
    await followUser(db, viewer, friend)

    const stamp = Date.now()
    // The friend's three, oldest first, so ordering has something to get wrong.
    await log(friend, await newItem('Older'), 'consumed', stamp)
    await log(friend, await newItem('Newer'), 'want_to_consume', stamp + 1)
    await log(friend, await newItem('Rejected'), 'not_interested', stamp + 2)
    // Nobody the viewer follows.
    await log(stranger, await newItem('Stranger'), 'consumed', stamp + 3)
    // The viewer's own log is not activity *from* anyone they follow.
    await log(viewer, await newItem('Mine'), 'consumed', stamp + 4)
  })

  after(async () => {
    for (const id of [viewer, friend, stranger]) {
      if (!id) continue
      await pool.query('delete from user_media_interactions where user_id = $1', [id])
      await pool.query('delete from user_follows where follower_id = $1 or followed_id = $1', [id])
      await pool.query('delete from users where id = $1', [id])
    }
    if (itemIds.length) await pool.query('delete from media_items where id = any($1)', [itemIds])
    await pool.end()
  })

  it('shows only what the people you follow logged', async () => {
    const entries = await listFollowingLogActivity(viewer, 10)
    assert.deepEqual(
      entries.map((entry) => entry.item?.title),
      ['Newer', 'Older'],
    )
    assert.ok(entries.every((entry) => entry.actor.id === friend))
  })

  it('names the person who logged it', async () => {
    const [entry] = await listFollowingLogActivity(viewer, 10)
    assert.match(entry!.actor.label, /^feed-friend-/)
  })

  it('takes the newest rows up to the limit', async () => {
    const entries = await listFollowingLogActivity(viewer, 1)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.item?.title, 'Newer')
  })

  it('is empty for someone following nobody', async () => {
    assert.deepEqual(await listFollowingLogActivity(stranger, 10), [])
  })
})
