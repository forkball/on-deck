import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { hashPassword } from '../app/actions/auth/password.ts'
import type { CatalogProvider, CatalogSearchResult } from '../app/data/catalog/provider.ts'
import type { CatalogQuery } from '../app/data/catalog/query.ts'
import { db, pool } from '../app/data/db.ts'
import { loadBatch, loadReview, loadRows, saveBatch } from '../app/data/imports/batches.ts'
import { matchBatch } from '../app/data/imports/matcher.ts'
import { importBatches, users } from '../app/data/schema.ts'
import { routes } from '../app/routes.ts'
import { post, sessionCookieFrom } from './support/router.ts'
import { deleteUsers, insertUser, skipWithoutDatabase, type TestUser } from './support/db.ts'

// A Steam import end to end, minus Steam and IGDB: the upload stages a batch
// and redirects to it instead of importing inside the request, a Steam failure
// is a 400 with Steam's message, a second upload lands on the unfinished batch,
// and matching the batch applies the Steam rules — exact titles, editions
// merged, playtime deciding the status — before review and save.

const STEAM_ID = '76561197960287930'

interface SteamStub {
  calls: string[]
  respond: (url: URL) => Response
}

const steam: SteamStub = { calls: [], respond: () => new Response('{}') }
const realFetch = globalThis.fetch

function library(games: { appid: number; name: string; playtime_forever: number }[]): Response {
  return Response.json({ response: { game_count: games.length, games } })
}

describe('a steam library import', { skip: skipWithoutDatabase }, () => {
  const PASSWORD = 'correct-horse-battery'
  let me: TestUser
  let cookie: string
  let batchId: string
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const igdb = (n: string) => `steam-test-${stamp}-${n}`

  before(async () => {
    process.env.STEAM_API_KEY = 'test-key'
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.hostname !== 'api.steampowered.com') return realFetch(input, init)
      steam.calls.push(url.pathname)
      return steam.respond(url)
    }) as typeof fetch

    me = await insertUser('steam-import', await hashPassword(PASSWORD))
    await db.update(users, me.id, { steam_id: STEAM_ID, steam_persona: 'old name' })

    const login = await post('/auth/login', { identifier: me.email, password: PASSWORD })
    cookie = sessionCookieFrom(login)!
    assert.ok(cookie, 'expected the login to start a session')
  })

  after(async () => {
    globalThis.fetch = realFetch
    delete process.env.STEAM_API_KEY
    await pool.query(
      'delete from import_rows where batch_id in (select id from import_batches where user_id = $1)',
      [me.id],
    )
    await pool.query('delete from import_batches where user_id = $1', [me.id])
    await deleteUsers([me.id])
    await pool.query('delete from media_items where external_id like $1', [`steam-test-${stamp}-%`])
    await pool.end()
  })

  it("renders Steam's message with a 400 when the profile is private, staging nothing", async () => {
    steam.respond = () => Response.json({ response: {} })

    const response = await post(routes.profile.importGames.upload.href(), {}, cookie)

    assert.equal(response.status, 400)
    assert.match(response.body, /Game details/)
    const { rows } = await pool.query('select id from import_batches where user_id = $1', [me.id])
    assert.equal(rows.length, 0)
  })

  it('renders a 400 when Steam cannot be reached at all', async () => {
    steam.respond = () => {
      throw new TypeError('fetch failed')
    }

    const response = await post(routes.profile.importGames.upload.href(), {}, cookie)

    assert.equal(response.status, 400)
    assert.match(response.body, /reach Steam/)
  })

  it('stages the library as a batch and redirects to it', async () => {
    steam.calls = []
    steam.respond = (url) =>
      url.pathname.includes('GetPlayerSummaries')
        ? Response.json({ response: { players: [{ steamid: STEAM_ID, personaname: 'new name' }] } })
        : library([
            { appid: 1, name: 'Batman: Arkham Asylum', playtime_forever: 0 },
            { appid: 2, name: 'Batman: Arkham Asylum Game of the Year Edition', playtime_forever: 90 },
            { appid: 3, name: 'Celeste', playtime_forever: 0 },
            { appid: 4, name: 'Celeste Original Soundtrack', playtime_forever: 0 },
            { appid: 5, name: 'Some Obscure Thing', playtime_forever: 12 },
          ])

    const response = await post(routes.profile.importGames.upload.href(), {}, cookie)

    assert.equal(response.status, 303)
    const match = response.location?.match(/^\/profile\/imports\/([0-9a-f-]+)$/)
    assert.ok(match, `expected a redirect to the staged batch, got ${response.location}`)
    batchId = match[1]!

    const batch = await loadBatch(db, batchId, me.id)
    assert.equal(batch?.status, 'matching')
    assert.equal(batch?.media_type, 'game')
    assert.equal(batch?.source, 'steam')

    // Staged, not logged: nothing reaches the log before review.
    const rows = await loadRows(db, batchId)
    assert.deepEqual(
      rows.map((row) => [row.raw_title, row.log_status, row.state]),
      [
        ['Batman: Arkham Asylum', 'want_to_consume', 'pending'],
        ['Batman: Arkham Asylum Game of the Year Edition', 'consumed', 'pending'],
        ['Celeste', 'want_to_consume', 'pending'],
        ['Some Obscure Thing', 'consumed', 'pending'],
      ],
    )
    const logged = await pool.query('select 1 from user_media_interactions where user_id = $1', [me.id])
    assert.equal(logged.rows.length, 0)

    const user = await db.find(users, me.id)
    assert.equal(user?.steam_persona, 'new name')
  })

  it('sends a second upload to the unfinished batch without asking Steam again', async () => {
    steam.calls = []

    const response = await post(routes.profile.importGames.upload.href(), {}, cookie)

    assert.equal(response.status, 303)
    assert.equal(response.location, routes.profile.imports.show.href({ batchId }))
    assert.deepEqual(steam.calls, [])
  })

  it('matches by exact title, merges editions, and saves them with the steam source', async () => {
    const result = (n: string, title: string): CatalogSearchResult => ({
      externalId: igdb(n),
      title,
      releaseYear: 2009,
      tags: [],
      posterUrl: null,
      popularity: 1,
      overview: null,
      runtimeMinutes: null,
    })
    const catalog: Record<string, CatalogSearchResult[]> = {
      'Batman: Arkham Asylum': [result('aa', 'Batman: Arkham Asylum')],
      'batman arkham asylum': [result('aa', 'Batman: Arkham Asylum')],
      Celeste: [result('celeste', 'Celeste'), result('celeste-64', 'Celeste 64')],
      'Some Obscure Thing': [result('other', 'Some Obscure Thing 2')],
    }
    const provider = {
      search: async (query: CatalogQuery) => catalog[query.title ?? ''] ?? [],
      getById: async () => null,
    } as unknown as CatalogProvider

    const batch = await loadBatch(db, batchId, me.id)
    assert.ok(batch)
    await matchBatch(db, batch, provider)

    const matched = await loadBatch(db, batchId, me.id)
    assert.equal(matched?.status, 'review')
    assert.equal(matched?.total_rows, 3)

    // The two Arkham Asylum listings are one row now, played because the GOTY
    // edition was; the near miss is left for review to search for.
    const rows = await loadRows(db, batchId)
    assert.deepEqual(
      rows.map((row) => [row.raw_title, row.log_status, row.state, row.reason ?? null]),
      [
        ['Batman: Arkham Asylum', 'consumed', 'confident', 'exact'],
        ['Celeste', 'want_to_consume', 'confident', 'exact'],
        ['Some Obscure Thing', 'consumed', 'not_found', null],
      ],
    )

    const { model } = await loadReview(db, matched!)
    assert.equal(model.duplicates.length, 0)
    assert.equal(model.uncertain.length, 0)
    assert.equal(model.notFound.length, 1)

    const saved = await saveBatch(db, matched!)
    assert.equal(saved.saved, 2)
    const { rows: logged } = await pool.query<{ status: string; source: string; external_id: string }>(
      `select i.status, i.source, m.external_id
         from user_media_interactions i join media_items m on m.id = i.media_item_id
        where i.user_id = $1 order by m.external_id`,
      [me.id],
    )
    assert.deepEqual(
      logged.map((row) => [row.external_id, row.status, row.source]),
      [
        [igdb('aa'), 'consumed', 'steam'],
        [igdb('celeste'), 'want_to_consume', 'steam'],
      ],
    )
    assert.equal((await db.find(importBatches, batchId))?.status, 'done')
  })
})
