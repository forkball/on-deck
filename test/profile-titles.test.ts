import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { db, pool } from '../app/data/db.ts'
import {
  composeTitle,
  earnedTitleKeys,
  parseTitleChoice,
  TITLES,
  titleByKey,
  titleProgress,
  type ConsumedEntry,
  type TitleStats,
} from '../app/data/profileTitles/catalog.ts'
import { checkTitleUnlocks, loadWornTitle } from '../app/data/profileTitles/unlocks.ts'
import { listNotifications } from '../app/data/notifications.ts'
import { deleteUsers, insertUser, skipWithoutDatabase } from './support/db.ts'

function stats(overrides: Partial<TitleStats> = {}): TitleStats {
  return {
    consumed: [],
    rated: 0,
    topRated: 0,
    disliked: 0,
    withNotes: 0,
    wantToConsume: 0,
    notInterested: 0,
    imported: 0,
    following: 0,
    followers: 0,
    recommendedTypes: [],
    luckyRuns: 0,
    ...overrides,
  }
}

function entries(count: number, entry: Partial<ConsumedEntry> = {}): ConsumedEntry[] {
  return Array.from({ length: count }, () => ({ type: 'movie', tags: [], popularity: 50, ...entry }))
}

describe('title catalog', () => {
  it('earns one unique word per achievement', () => {
    assert.equal(new Set(TITLES.map((t) => t.key)).size, TITLES.length)
    assert.equal(new Set(TITLES.map((t) => t.word)).size, TITLES.length)
  })

  it('has a genre and a role that are easy to come by', () => {
    // Someone's first log and first rating are enough for a title of their own.
    const easy = earnedTitleKeys(stats({ consumed: entries(1), rated: 1 })).filter(
      (key) => !titleByKey(key)?.starter,
    )
    assert.deepEqual(easy.map((key) => titleByKey(key)?.part).sort(), ['adjective', 'noun'])
  })

  it('gives an empty account the starter title and nothing else', () => {
    assert.deepEqual(earnedTitleKeys(stats()), ['newborn', 'baby'])
    assert.equal(composeTitle('newborn', 'baby'), 'Newborn Baby')
  })

  it('earns the rookie title from one finished thing', () => {
    assert.deepEqual(earnedTitleKeys(stats({ consumed: entries(1) })), ['newborn', 'baby', 'rookie'])
  })

  it('counts obscure films toward Art House, but not ones the catalog gave no popularity', () => {
    const obscure = entries(9, { popularity: 2.5 })
    const unknown = entries(5, { popularity: null }).concat(entries(5, { popularity: 0 }))
    assert.ok(!earnedTitleKeys(stats({ consumed: [...obscure, ...unknown] })).includes('art_house'))
    assert.ok(
      earnedTitleKeys(stats({ consumed: [...obscure, ...entries(1, { popularity: 1 })] })).includes(
        'art_house',
      ),
    )
    // A book nobody has heard of is not an art-house film.
    assert.ok(
      !earnedTitleKeys(stats({ consumed: entries(10, { type: 'book', popularity: 1 }) })).includes(
        'art_house',
      ),
    )
  })

  it('counts a genre across media, each entry once', () => {
    const consumed = [
      ...entries(5, { tags: ['horror'] }),
      ...entries(5, { type: 'book', tags: ['horror', 'thriller'] }),
    ]
    assert.ok(earnedTitleKeys(stats({ consumed })).includes('horror'))

    // Tagged both mystery and crime: one entry, not two.
    const mystery = titleProgress(stats({ consumed: entries(8, { tags: ['mystery', 'crime'] }) })).find(
      (p) => p.title.key === 'mystery',
    )!
    assert.equal(mystery.current, 8)
    assert.equal(mystery.earned, false)
  })

  it('needs every medium for Polymath', () => {
    const three = ['movie', 'tv', 'book'].flatMap((type) => entries(5, { type }))
    assert.ok(!earnedTitleKeys(stats({ consumed: three })).includes('polymath'))
    assert.ok(
      earnedTitleKeys(stats({ consumed: [...three, ...entries(5, { type: 'game' })] })).includes('polymath'),
    )
  })

  it('composes a title from either half or both', () => {
    assert.equal(composeTitle('art_house', 'projectionist'), 'Art House Projectionist')
    assert.equal(composeTitle('art_house', 'couch_potato'), 'Art House Couch Potato')
    assert.equal(composeTitle(null, 'bookworm'), 'Page-Turner')
    assert.equal(composeTitle('horror', null), 'Jump-Scared')
    assert.equal(composeTitle(null, null), null)
    assert.equal(composeTitle('retired-key', null), null)
    // A word only goes in its own slot.
    assert.equal(composeTitle('bookworm', 'horror'), null)
  })

  it('only accepts titles that have been unlocked', () => {
    const unlocked = new Set(['rookie', 'horror', 'bookworm'])
    assert.deepEqual(parseTitleChoice({ adjective: 'horror', noun: 'rookie' }, unlocked), {
      adjective: 'horror',
      noun: 'rookie',
    })
    assert.deepEqual(parseTitleChoice({ adjective: '', noun: 'rookie' }, unlocked), {
      adjective: null,
      noun: 'rookie',
    })
    assert.equal(parseTitleChoice({ adjective: 'art_house', noun: 'rookie' }, unlocked), null)
    // Earned, but a noun can't be worn as the first word.
    assert.equal(parseTitleChoice({ adjective: 'bookworm', noun: 'rookie' }, unlocked), null)
  })
})

describe('title unlocks', { skip: skipWithoutDatabase }, () => {
  let userId: number
  const itemIds: number[] = []

  before(async () => {
    userId = await insertUser('titles')
    const stamp = Date.now()
    for (let index = 0; index < 10; index++) {
      const {
        rows: [item],
      } = await pool.query<{ id: number }>(
        `insert into media_items (type, external_source, external_id, title, metadata, popularity_score, created_at)
         values ('movie', 'test', $1, $2, '{"tags":["horror"]}'::jsonb, 1.5, $3) returning id`,
        [`titles-${stamp}-${index}`, `Scary ${index}`, stamp],
      )
      itemIds.push(item!.id)
    }
  })

  after(async () => {
    await deleteUsers([userId])
    await pool.query('delete from media_items where id = any($1)', [itemIds])
  })

  async function logMovies(ids: number[]) {
    for (const id of ids) {
      await pool.query(
        `insert into user_media_interactions (user_id, media_item_id, status, created_at, updated_at)
         values ($1, $2, 'consumed', $3, $3)`,
        [userId, id, Date.now()],
      )
    }
  }

  it('unlocks, notifies once, and puts the starter title on', async () => {
    // The starter title goes on unannounced.
    assert.deepEqual((await checkTitleUnlocks(db, userId)).newlyUnlocked, ['newborn', 'baby'])
    assert.deepEqual(await loadWornTitle(db, userId), { adjective: 'newborn', noun: 'baby' })
    assert.deepEqual(await listNotifications(db, userId), [])

    await logMovies(itemIds.slice(0, 1))
    const first = await checkTitleUnlocks(db, userId)
    assert.deepEqual(first.newlyUnlocked, ['rookie'])

    // Checking again finds nothing new and says nothing more.
    assert.deepEqual((await checkTitleUnlocks(db, userId)).newlyUnlocked, [])

    await logMovies(itemIds.slice(1))
    const second = await checkTitleUnlocks(db, userId)
    assert.deepEqual(second.newlyUnlocked, ['art_house', 'horror'])
    // Already wearing one, so the new unlocks don't replace it.
    assert.deepEqual(await loadWornTitle(db, userId), { adjective: 'newborn', noun: 'baby' })

    const notifications = await listNotifications(db, userId)
    assert.deepEqual(
      notifications.map((n) => [n.type, n.unlockedTitles]),
      [
        ['title', ['art_house', 'horror']],
        ['title', ['rookie']],
      ],
    )
  })

  it('records without notifying when asked to be quiet', async () => {
    const quietId = await insertUser('titles-quiet')
    try {
      await pool.query(
        `insert into user_media_interactions (user_id, media_item_id, status, created_at, updated_at)
         values ($1, $2, 'consumed', $3, $3)`,
        [quietId, itemIds[0], Date.now()],
      )
      const check = await checkTitleUnlocks(db, quietId, { notify: false })
      assert.deepEqual(check.newlyUnlocked, ['newborn', 'baby', 'rookie'])
      assert.deepEqual(await listNotifications(db, quietId), [])
      // Still put on: quiet is about the bell, not the title.
      assert.deepEqual(await loadWornTitle(db, quietId), { adjective: 'newborn', noun: 'baby' })
    } finally {
      await deleteUsers([quietId])
    }
  })

  it('keeps a title once earned', async () => {
    await pool.query('delete from user_media_interactions where user_id = $1', [userId])
    const check = await checkTitleUnlocks(db, userId)
    assert.ok(check.unlocked.has('horror'))
    assert.equal(check.newlyUnlocked.length, 0)
  })
})
