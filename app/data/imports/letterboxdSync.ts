import { and, eq, gt, gte, inList } from 'remix/data-table'

import { getCatalogProvider, upsertCatalogItem } from '../catalog/provider.ts'
import { runBounded } from './csv.ts'
import type { Db } from '../db.ts'
import { logInteraction, normalizeRating } from '../mediaItems.ts'
import {
  INTERACTION_SOURCES,
  mediaItems,
  userMediaInteractions,
  users,
  type MediaItem,
  type User,
} from '../schema.ts'
import { fetchLetterboxdFeed, letterboxdSyncAvailableTo, type LetterboxdEntry } from './letterboxdFeed.ts'

// Only the entries needing a TMDB detail lookup do any network work, and after
// the first sync that is usually none of them — so this bounds a list that is
// normally empty.
const CONCURRENCY = 8

// How long a feed fetch is worth avoiding. The feed sends no ETag and no
// Last-Modified, so there is no cheap way to ask "anything new?" — every poll
// pulls the whole ~220KB body, and the profile page would otherwise fetch it on
// every load.
const COOLDOWN_MS = 15 * 60 * 1000

// What a caller in front of a person will wait before giving up and letting the
// sync finish on its own.
const WAIT_MS = 3_000

export interface LetterboxdSyncResult {
  // Diary entries the feed held, before the connection point narrowed them.
  // The difference between the two is what separates "your diary is empty"
  // from "nothing new since you connected" — which read identically once
  // connecting stopped backfilling, and only one of them is worth worrying
  // about.
  carried: number
  logged: number
  // Entries whose TMDB id no longer resolves — a deleted or merged record.
  unresolved: number
  // Rows removed because the feed no longer accounts for them.
  deleted: number
}

// Reads the member's public diary and writes it into the log.
//
// Every entry in the feed is re-read on every sync rather than stopping at the
// last one seen. That is deliberate: the feed is the source of truth for these
// rows, so a rating or review revised on Letterboxd has to be able to reach a
// film logged weeks ago. `letterboxd_synced_at` throttles how often the fetch
// happens; it is not a watermark over which entries have been handled.
//
// Removals travel the same way, within limits the feed imposes: it carries a
// bounded number of the most recently published entries, so it can only speak
// for that window. What falls outside it is unknown, not gone, and
// selectRemovable is where that line is held.
export async function syncLetterboxdDiary(
  db: Db,
  userId: number,
  username: string,
): Promise<LetterboxdSyncResult> {
  const outcome = await fetchLetterboxdFeed(username)
  if (!outcome.ok) throw new Error(outcome.message)

  // Read before the writes below touch anything: this is what the *last* fetch
  // saw, and comparing the two is the only way to know why the window moved.
  const user = await db.find(users, userId)
  const previous: PreviousFeed = {
    floor: user?.letterboxd_feed_floor ?? null,
    items: user?.letterboxd_feed_items ?? null,
  }

  let logged = 0
  let unresolved = 0

  const connectedAt = user?.letterboxd_connected_at ?? null
  const entries = foldRewatches(sinceConnected(outcome.entries, connectedAt))

  await runBounded(entries, CONCURRENCY, async (entry) => {
    const item = await resolveMovie(db, entry.tmdbId)
    if (!item) {
      unresolved++
      return
    }

    await logInteraction(db, userId, item.id, {
      status: 'consumed',
      // Three-state, and the distinction carries the conflict rule: Letterboxd
      // wins wherever Letterboxd has an opinion. An unrated watch says nothing
      // about the rating, so it passes undefined and leaves one set here alone
      // rather than clearing it.
      rating: entry.rating == null ? undefined : normalizeRating(entry.rating),
      // Same rule. Only a review carries text; a plain watch entry passes
      // undefined so its boilerplate description can't overwrite a real note.
      notes: entry.notes ?? undefined,
      consumedAt: entry.watchedAt ?? undefined,
      // Claims the row for the feed only if the feed is what created it. An
      // existing row keeps whatever source it already had — see the note on
      // LogInteractionInput.source.
      source: INTERACTION_SOURCES.letterboxdFeed,
      sourceEntryAt: entry.publishedAt ?? undefined,
    })

    logged++
  })

  // Composed here rather than inside a loader, so the rule that decides what
  // gets destroyed is visible at the point it runs. A feed that can't place
  // its own window answers for nothing and never reaches the database.
  const coverage = coverageFrom(outcome.entries, entries, connectedAt, previous)
  const removable = coverage == null ? [] : selectRemovable(entries, await loadSyncedRows(db, userId, coverage), coverage)

  const removed: string[] = []

  // One at a time rather than a bulk delete by id list, which would be a single
  // statement: what the loop buys is knowing which rows actually went, and the
  // audit line below is the only record any of them existed.
  for (const row of removable) {
    if (await db.delete(userMediaInteractions, row.interactionId)) {
      removed.push(`${row.title} [tmdb:${row.tmdbId}]`)
    }
  }

  if (removed.length > 0) {
    // Named rather than counted, and written after the fact: nothing else in
    // the log records that a row existed, so this line is the only account of
    // what a background job took and why it believed it should.
    console.info(
      `Letterboxd sync removed ${removed.length} row(s) for user ${userId}, absent from the feed: ${removed.join(', ')}`,
    )
  }

  // Recorded last, and always — including when the feed answered for nothing,
  // since a diary emptied to lists is exactly what the next sync needs to know
  // about. What is stored is this fetch's own floor, never the widened one
  // above: the widening is a claim about an interval, and reusing it would let
  // the window creep further back on every sync.
  await db.update(users, userId, {
    letterboxd_feed_floor: oldestPublished(entries) ?? undefined,
    letterboxd_feed_items: entries.length,
  })

  return { carried: outcome.entries.length, logged, unresolved, deleted: removed.length }
}

// Everything the feed carries that was written after the member connected.
//
// The feed is a window on a diary, not the diary: the fifty entries it happens
// to hold are the last few weeks for one member and the last few years for
// another. Taking them at connection time brought an arbitrary slice of a
// library across as though it were the library, and — because recommendations
// exclude what the log knows about — made everything it missed look unwatched.
// So connecting follows what comes next, and the CSV import is what brings the
// past.
//
// An undated entry is dropped rather than kept: nothing places it against the
// connection point, and "we cannot tell whether this is new" is not a reason to
// treat it as new.
//
// A null connection point is a member who connected before this rule existed.
// They keep the whole window, because narrowing it now would strand the rows
// they already have outside everything that maintains them.
export function sinceConnected(entries: LetterboxdEntry[], connectedAt: number | null): LetterboxdEntry[] {
  if (connectedAt == null) return entries

  return entries.filter((entry) => entry.publishedAt != null && entry.publishedAt > connectedAt)
}

// Where the delete pass may reach, once the connection point is in play.
//
// While the feed still carries something from before the member connected, it
// reaches back past everything they can own here — so every row the feed could
// have written is in view, and any absence is a deletion. The connection point
// is the floor, and the feed's own truncation cannot reach above it.
//
// Once every entry in the window is one of theirs, the feed has filled up with
// their own diary and can truncate again, so the ordinary rule takes over.
export function coverageFrom(
  all: LetterboxdEntry[],
  mine: LetterboxdEntry[],
  connectedAt: number | null,
  previous: PreviousFeed,
): FeedCoverage | null {
  if (connectedAt == null) return feedCoverage(mine, previous)
  if (mine.length === 0) return null

  const reachesPastConnection = all.some((entry) => entry.publishedAt != null && entry.publishedAt <= connectedAt)

  return reachesPastConnection ? { at: connectedAt, inclusive: false } : feedCoverage(mine, previous)
}

// The floor this fetch alone can vouch for. Kept apart from feedCoverage
// because that answers "what may be deleted" and this answers "what did we
// see" — the same number only when the feed did not shrink.
function oldestPublished(entries: LetterboxdEntry[]): number | null {
  const published = entries.map((entry) => entry.publishedAt).filter((at) => at != null)
  return published.length === 0 ? null : Math.min(...published)
}

// How far back the feed can currently answer for, and whether the entry
// sitting exactly on that line is included.
export interface FeedCoverage {
  at: number
  // True only when `at` came from the previous fetch rather than this one. The
  // entry on the line is then the one that went missing, not the one the line
  // was read from — see feedCoverage.
  inclusive: boolean
}

// What the last fetch saw, as stored on the member's row.
export interface PreviousFeed {
  floor: number | null
  items: number | null
}

// A feed that lost more items than this in one interval is not someone tidying
// their diary. It is a short response, a partial render, or Letterboxd changing
// what it publishes — and trusting it would delete rows that are still there.
// Beyond it the pass falls back to what the current fetch alone can prove.
const MAX_SHRINK = 10

// The line the delete pass measures against.
//
// Normally it is the oldest entry the feed still shows: everything published
// after that would still be carried if it existed, so its absence is a
// deletion, and everything before it is out of view, which is not the same as
// gone. Exclusive, because the entry on the line is the one the line was read
// from.
//
// That rule cannot see the bottom of its own window. Delete the oldest entry
// the feed shows and, with nothing older to backfill, the line rises to the
// next one — so the row that just went now sits below it and is refused, by the
// guard written to protect the back catalogue. In a diary that fits inside the
// feed the line only ever climbs, so the orphan is out of reach for good.
//
// Telling that from truncation needs the previous fetch, because the current
// one cannot say why its floor moved. Truncation happens when a full feed takes
// something new, and a full feed that truncates keeps its item count — so a
// count that *fell* is a feed that lost items with nothing refilling it.
// Nothing was pushed out, and the window still reaches where it reached last
// time. Inclusive there, because the entry that defined the old floor is
// exactly the one that may have been deleted.
//
// Null when the feed carries no dated diary entry at all: a member who cleared
// their diary, or a feed that is all lists. That is the case a naive diff reads
// as "everything was deleted", so it has to be a refusal rather than a floor of
// zero.
export function feedCoverage(
  entries: LetterboxdEntry[],
  previous: PreviousFeed = { floor: null, items: null },
): FeedCoverage | null {
  const published = entries.map((entry) => entry.publishedAt).filter((at) => at != null)
  if (published.length === 0) return null

  const floor = Math.min(...published)

  // Diary entries, not raw <item>s. The feed is two separate blocks with
  // separate caps — see the note on ITEM_PATTERN — so a list cannot push an
  // entry out of view, and counting lists would be worse than useless here:
  // deleting one would read as a diary that shrank and widen the window onto
  // rows that were only truncated.
  const count = entries.length

  const shrank =
    previous.items != null &&
    previous.floor != null &&
    count < previous.items &&
    previous.items - count <= MAX_SHRINK

  // min() rather than the previous floor outright: a feed can shrink and
  // backfill in the same interval, and the lower of the two is the one both
  // fetches can vouch for.
  return shrank ? { at: Math.min(floor, previous.floor!), inclusive: true } : { at: floor, inclusive: false }
}

export function withinCoverage(at: number | null, coverage: FeedCoverage): boolean {
  if (at == null) return false
  return coverage.inclusive ? at >= coverage.at : at > coverage.at
}

// Which of a member's feed-written rows the current feed says are gone.
//
// Separated from the query that feeds it because this is the whole of the
// decision, and it is the part worth being able to check: everything that makes
// deletion safe is one of the refusals below, and none of them needs a database
// to demonstrate.
export function selectRemovable(
  entries: LetterboxdEntry[],
  rows: SyncedRow[],
  coverage: FeedCoverage | null,
): SyncedRow[] {
  if (coverage == null) return []

  const present = new Set(entries.map((entry) => entry.tmdbId))

  return rows.filter((row) => {
    // No catalog id, nothing to compare against the feed. No evidence either
    // way is not grounds for removing anything.
    if (row.tmdbId == null) return false
    if (present.has(row.tmdbId)) return false
    // An undated row is anything written before the column existed; it cannot
    // be placed against the window at all.
    return withinCoverage(row.sourceEntryAt, coverage)
  })
}

// A row the feed created, as the rule above needs to see it: what it points at
// in the catalog, and when the entry behind it was published.
export interface SyncedRow {
  interactionId: number
  tmdbId: string | null
  title: string
  sourceEntryAt: number | null
}

// Everything the feed sync has written for this member that the coverage line
// can speak for. Two queries rather than a join because the table API can't
// express one.
//
// The line is applied in SQL as well as in selectRemovable, which is not
// redundant so much as differently motivated: there it is the rule, here it is
// what keeps the read proportional to the feed rather than to a member's whole
// history. Both comparisons also exclude NULLs exactly as the rule does, so the
// narrower read cannot change the answer.
async function loadSyncedRows(db: Db, userId: number, coverage: FeedCoverage): Promise<SyncedRow[]> {
  const rows = await db.findMany(userMediaInteractions, {
    where: and(
      eq('user_id', userId),
      eq('source', INTERACTION_SOURCES.letterboxdFeed),
      coverage.inclusive ? gte('source_entry_at', coverage.at) : gt('source_entry_at', coverage.at),
    ),
  })
  if (rows.length === 0) return []

  const items = await db.findMany(mediaItems, {
    where: inList(
      'id',
      rows.map((row) => row.media_item_id),
    ),
  })
  const itemsById = new Map(items.map((item) => [item.id, item]))

  return rows.map((row) => {
    const item = itemsById.get(row.media_item_id)
    return {
      interactionId: row.id,
      tmdbId: item?.external_id ?? null,
      title: item?.title ?? `media item ${row.media_item_id}`,
      sourceEntryAt: row.source_entry_at,
    }
  })
}

// A rewatch is a second diary entry for a film already in the feed, and an
// interaction is unique on (user, media_item) — so the two entries were always
// going to land on one row. Folding them here rather than letting both through
// makes that explicit, and avoids the race it otherwise causes: two entries for
// one film resolved concurrently both miss the catalog lookup and both try to
// create the same media_items row, which the unique index rejects.
//
// Feed order is newest first, so the first entry seen is the most recent watch
// and its date and rating win. Anything it left empty is filled from the older
// entry — a rewatch logged without a note shouldn't drop the review written the
// first time round.
export function foldRewatches(entries: LetterboxdEntry[]): LetterboxdEntry[] {
  const byFilm = new Map<string, LetterboxdEntry>()

  for (const entry of entries) {
    const seen = byFilm.get(entry.tmdbId)
    if (!seen) {
      // Copied rather than held, so filling the gaps below can't reach back and
      // edit the caller's entries.
      byFilm.set(entry.tmdbId, { ...entry })
      continue
    }

    seen.rating ??= entry.rating
    seen.notes ??= entry.notes
    seen.watchedAt ??= entry.watchedAt
    // Kept from the newest entry for the same reason the others are, and it
    // matters more here: this is what holds the film inside the feed's window,
    // so taking the older entry's date would age a row out of coverage while
    // the feed is still carrying it.
    seen.publishedAt ??= entry.publishedAt
  }

  return [...byFilm.values()]
}

// The feed names the film by TMDB id, so an entry already in the catalog needs
// no lookup at all. This is what keeps a steady-state sync to one HTTP request
// instead of one per entry.
async function resolveMovie(db: Db, tmdbId: string): Promise<MediaItem | null> {
  const provider = getCatalogProvider('movie')

  const existing = await db.findOne(mediaItems, {
    where: { type: 'movie', external_source: provider.sourceName, external_id: tmdbId },
  })
  if (existing) return existing

  const detail = await provider.getById(tmdbId)
  if (!detail) return null

  // True because this *is* the detail lookup — without it the row claims to be
  // enriched off a search result and never fetches credits. See the note on
  // upsertCatalogItem.
  return upsertCatalogItem(db, 'movie', detail, true)
}

// One sync per user at a time within this process. Deduped the way
// backfillCatalogDetail is: the same page can be loaded twice before the first
// fetch returns.
//
// The promise carries the result rather than void, because one of the three
// callers below has somebody waiting on the answer. It can also reject, and
// every caller that takes it either awaits it or attaches a handler — a stored
// promise nobody handles is an unhandled rejection, which takes the process
// down.
const inFlight = new Map<number, Promise<LetterboxdSyncResult>>()

// `force` skips the cooldown, and only a member's own request passes it. The
// cooldown is there to keep page loads off Letterboxd — see COOLDOWN_MS — and
// a click is not a page load. It does not skip the dedup above: a sync already
// reading the feed is the fresh read being asked for, so the caller joins it.
function startSync(db: Db, user: User, force = false): Promise<LetterboxdSyncResult> | null {
  // The one place all three triggers pass through, so the gate is checked here
  // rather than at each of them.
  if (!letterboxdSyncAvailableTo(user)) return null

  const username = user.letterboxd_username
  if (!username) return null

  const running = inFlight.get(user.id)
  if (running) return running

  const syncedAt = user.letterboxd_synced_at
  if (!force && syncedAt != null && Date.now() - syncedAt < COOLDOWN_MS) return null

  const run = (async () => {
    // Stamped before the work, not after: a sync that fails should wait out the
    // cooldown like any other, or a member whose feed has gone private would
    // have every page load retry the fetch.
    await db.update(users, user.id, { letterboxd_synced_at: Date.now() })
    return syncLetterboxdDiary(db, user.id, username)
  })().finally(() => {
    inFlight.delete(user.id)
  })

  inFlight.set(user.id, run)
  return run
}

// What the two triggers with nobody waiting on them do with a failure. There is
// no response to put it on, and a member who connected an account deserves
// better than silence in the log.
function swallow(userId: number, run: Promise<LetterboxdSyncResult>): Promise<void> {
  return run.then(
    () => undefined,
    (error: unknown) => {
      console.error(`Letterboxd sync failed for user ${userId}:`, error)
    },
  )
}

// Fire-and-forget, for a page that only needs the log to be current the next
// time it is looked at. Never awaited on a render: a feed fetch plus a detail
// lookup per new film does not belong on the response path.
export function syncLetterboxdInBackground(db: Db, user: User): void {
  const run = startSync(db, user)
  if (!run) return

  void swallow(user.id, run)
}

// For a caller that would rather not act on a stale log — a recommendation run
// generating against films the member already watched. Bounded, because a slow
// feed is not a reason to fail the thing the member actually asked for; the
// sync carries on in the background either way.
export async function syncLetterboxdBeforeRun(db: Db, user: User): Promise<void> {
  const run = startSync(db, user)
  if (!run) return

  await Promise.race([swallow(user.id, run), new Promise((resolve) => setTimeout(resolve, WAIT_MS).unref())])
}

// A member asking for the diary to be read now, and waiting for it. Awaited
// rather than raced: they pressed a button and the page they land on is the
// answer, so a slow feed is worth waiting out here in a way it never is on a
// render.
//
// The failure is thrown rather than logged, which is the whole difference from
// the two above: a sync nobody asked for has nowhere to put an error, and this
// one has a person reading the page it lands on. A feed gone private should say
// so rather than look like a diary with nothing in it.
//
// Null when there is nothing to sync — no username, or the gate is closed.
export async function syncLetterboxdNow(db: Db, user: User): Promise<LetterboxdSyncResult | null> {
  const run = startSync(db, user, true)

  return run ? run : null
}
