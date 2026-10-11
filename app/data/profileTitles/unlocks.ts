import type { Db } from '../db.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import { createTitleNotification } from '../notifications.ts'
import { users, userTitles } from '../schema.ts'
import { logger } from '../../log.ts'
import { earnedTitleKeys, titleByKey, titleProgress, type TitleProgress, type TitleStats } from './catalog.ts'

const log = logger('titles')

// Rows off db.exec, which can't be told their shape the way pool.query can.
async function rowsOf<Row>(db: Db, sql: string, values: unknown[]): Promise<Row[]> {
  const result = await db.exec(sql, values)
  return (result.rows ?? []) as Row[]
}

// Everything the catalog's rules read, for one member. Aggregates and a join the
// table API can't express, hence raw SQL — through the `db` handed in rather
// than the app's pool, so scripts/backfill-titles.ts can run this same code over
// a connection of its own.
export async function loadTitleStats(db: Db, userId: number): Promise<TitleStats> {
  const [consumed, [row]] = await Promise.all([
    rowsOf<{ type: string; metadata: unknown; popularity_score: number | null }>(
      db,
      `select m.type, m.metadata, m.popularity_score
         from user_media_interactions i
         join media_items m on m.id = i.media_item_id
        where i.user_id = $1 and i.status = 'consumed'`,
      [userId],
    ),
    rowsOf<{
      rated: number
      top_rated: number
      disliked: number
      with_notes: number
      want_to_consume: number
      not_interested: number
      imported: number
      following: number
      followers: number
      recommended_types: string[] | null
      lucky_runs: number
    }>(
      db,
      `select
         count(*) filter (where i.rating is not null)::int as rated,
         count(*) filter (where i.rating >= 5)::int as top_rated,
         count(*) filter (where i.disliked)::int as disliked,
         count(*) filter (where nullif(btrim(i.notes), '') is not null)::int as with_notes,
         count(*) filter (where i.status = 'want_to_consume')::int as want_to_consume,
         count(*) filter (where i.status = 'not_interested')::int as not_interested,
         count(*) filter (where i.source is not null and i.source <> 'manual')::int as imported,
         (select count(*)::int from user_follows where follower_id = $1) as following,
         (select count(*)::int from user_follows where followed_id = $1) as followers,
         (select array_agg(distinct media_type::text) from recommendation_runs
           where user_id = $1 and not is_lucky) as recommended_types,
         (select count(*)::int from recommendation_runs where user_id = $1 and is_lucky) as lucky_runs
       from user_media_interactions i
       where i.user_id = $1`,
      [userId],
    ),
  ])

  if (!row) throw new Error(`no stats row for user ${userId}`)
  return {
    consumed: consumed.map((entry) => ({
      type: entry.type,
      tags: parseMediaMetadata(entry.metadata).tags,
      popularity: entry.popularity_score,
    })),
    rated: row.rated,
    topRated: row.top_rated,
    disliked: row.disliked,
    withNotes: row.with_notes,
    wantToConsume: row.want_to_consume,
    notInterested: row.not_interested,
    imported: row.imported,
    following: row.following,
    followers: row.followers,
    recommendedTypes: row.recommended_types ?? [],
    luckyRuns: row.lucky_runs,
  }
}

export interface TitleCheck {
  progress: TitleProgress[]
  unlocked: Set<string>
  // Unlocked by this check, in catalog order.
  newlyUnlocked: string[]
}

// Works out what the member has earned, records anything new, and tells them.
//
// Called after the things that can earn a title — logging, an import saving, a
// follow, a run finishing — and on the pages that show titles, which is what
// catches the writes nothing calls this after (a Letterboxd feed sync, say).
// Cheap enough for that: two queries over one member's rows.
//
// `notify: false` records without telling anyone — the backfill's --quiet.
export async function checkTitleUnlocks(
  db: Db,
  userId: number,
  options: { notify?: boolean } = {},
): Promise<TitleCheck> {
  const [stats, existing] = await Promise.all([
    loadTitleStats(db, userId),
    db.findMany(userTitles, { where: { user_id: userId } }),
  ])
  const progress = titleProgress(stats)
  const unlocked = new Set(existing.map((row) => row.title_key))
  const earned = earnedTitleKeys(stats).filter((key) => !unlocked.has(key))
  if (earned.length === 0) return { progress, unlocked, newlyUnlocked: [] }

  // `on conflict … returning` is what makes two checks racing each other — a log
  // and a page load — notify once between them: only the one whose insert landed
  // gets the key back.
  const rows = await rowsOf<{ title_key: string }>(
    db,
    `insert into user_titles (user_id, title_key, unlocked_at)
     select $1, key, $3 from unnest($2::text[]) as key
     on conflict (user_id, title_key) do nothing
     returning title_key`,
    [userId, earned, Date.now()],
  )
  const inserted = new Set(rows.map((row) => row.title_key))
  const newlyUnlocked = earned.filter((key) => inserted.has(key))
  for (const key of earned) unlocked.add(key)

  if (newlyUnlocked.length > 0) {
    // The starter title isn't an achievement, so it isn't announced: being told
    // you've earned "Unrated" for having signed up is a strange welcome.
    const announced = newlyUnlocked.filter((key) => !titleByKey(key)?.starter)
    if (options.notify !== false && announced.length > 0) {
      await createTitleNotification(db, userId, announced)
    }
    // Somebody's first words go straight on, each in its own slot — which, as
    // the starter credits lead the catalog, is the starter title. Only while
    // they wear nothing, so a title someone chose is never swapped out.
    const firstOf = (part: 'adjective' | 'noun') =>
      newlyUnlocked.find((key) => titleByKey(key)?.part === part) ?? null
    await db.exec(
      `update users set title_adjective = $2, title_noun = $3
        where id = $1 and title_adjective is null and title_noun is null`,
      [userId, firstOf('adjective'), firstOf('noun')],
    )
  }

  return { progress, unlocked, newlyUnlocked }
}

// For the hooks after a write: a title is never worth failing the write over, and
// the next page that shows titles checks again anyway.
export async function checkTitleUnlocksQuietly(db: Db, userId: number): Promise<void> {
  try {
    await checkTitleUnlocks(db, userId)
  } catch (error) {
    log.warn(`title check failed for user ${userId}`, error)
  }
}

export async function chooseTitle(
  db: Db,
  userId: number,
  choice: { adjective: string | null; noun: string | null },
): Promise<void> {
  // `undefined` is what writes NULL — see updateUserProfile.
  await db.update(users, userId, {
    title_adjective: choice.adjective ?? undefined,
    title_noun: choice.noun ?? undefined,
  })
}

export async function loadUnlockedTitleKeys(db: Db, userId: number): Promise<Set<string>> {
  const rows = await db.findMany(userTitles, { where: { user_id: userId } })
  return new Set(rows.map((row) => row.title_key))
}

// Read fresh rather than off the request's identity, which was loaded before
// checkTitleUnlocks may have put a first title on.
export async function loadWornTitle(
  db: Db,
  userId: number,
): Promise<{ adjective: string | null; noun: string | null }> {
  const user = await db.find(users, userId)
  return { adjective: user?.title_adjective ?? null, noun: user?.title_noun ?? null }
}
