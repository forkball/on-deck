import { and, eq, gt, inList } from 'remix/data-table'

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

  let logged = 0
  let unresolved = 0

  const entries = foldRewatches(outcome.entries)

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
  const watermark = coverageWatermark(entries)
  const removable = watermark == null ? [] : selectRemovable(entries, await loadSyncedRows(db, userId, watermark))

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

  return { logged, unresolved, deleted: removed.length }
}

// A row the feed created, as the rule below needs to see it: what it points at
// in the catalog, and when the entry behind it was published.
export interface SyncedRow {
  interactionId: number
  tmdbId: string | null
  title: string
  sourceEntryAt: number | null
}

// Which of a member's feed-written rows the current feed says are gone.
//
// Separated from the query that feeds it because this is the whole of the
// decision, and it is the part worth being able to check: everything that makes
// deletion safe is one of the refusals below, and none of them needs a database
// to demonstrate.
export function selectRemovable(entries: LetterboxdEntry[], rows: SyncedRow[]): SyncedRow[] {
  const watermark = coverageWatermark(entries)
  if (watermark == null) return []

  const present = new Set(entries.map((entry) => entry.tmdbId))

  return rows.filter((row) => {
    // No catalog id, nothing to compare against the feed. No evidence either
    // way is not grounds for removing anything.
    if (row.tmdbId == null) return false
    if (present.has(row.tmdbId)) return false
    // Strictly newer, so the entry sitting exactly on the watermark is left
    // alone: it is the one the watermark was read from, and a tie there means
    // two entries published in the same instant — too thin a basis for deleting
    // someone's log. An undated row is anything written before the column
    // existed; it cannot be placed against the window at all.
    return row.sourceEntryAt != null && row.sourceEntryAt > watermark
  })
}

// Everything the feed sync has written for this member that the feed's current
// window can speak for. Two queries rather than a join because the table API
// can't express one.
//
// The watermark is applied in SQL as well as in selectRemovable, which is not
// redundant so much as differently motivated: there it is the rule, here it is
// what keeps the read proportional to the feed rather than to a member's whole
// history. `source_entry_at > watermark` also excludes NULLs in SQL exactly as
// the rule does in JS, so the narrower read cannot change the answer.
async function loadSyncedRows(db: Db, userId: number, watermark: number): Promise<SyncedRow[]> {
  const rows = await db.findMany(userMediaInteractions, {
    where: and(
      eq('user_id', userId),
      eq('source', INTERACTION_SOURCES.letterboxdFeed),
      gt('source_entry_at', watermark),
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

// The oldest entry the feed is currently showing. Everything published after
// this point is something the feed would still be carrying if it existed, so
// its absence is a deletion rather than a truncation — and everything before it
// is simply out of view, which is not the same as gone.
//
// Null when the feed carries no dated diary entry at all: a member who cleared
// their diary, or a feed that is all lists. That is exactly the case where a
// naive diff decides everything was deleted, so it has to be a refusal to act
// rather than a watermark of zero.
export function coverageWatermark(entries: LetterboxdEntry[]): number | null {
  const published = entries.map((entry) => entry.publishedAt).filter((at) => at != null)

  return published.length === 0 ? null : Math.min(...published)
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
const inFlight = new Map<number, Promise<void>>()

function startSync(db: Db, user: User): Promise<void> | null {
  // The one place both triggers pass through, so the gate is checked here
  // rather than at each of them.
  if (!letterboxdSyncAvailableTo(user)) return null

  const username = user.letterboxd_username
  if (!username) return null

  const running = inFlight.get(user.id)
  if (running) return running

  const syncedAt = user.letterboxd_synced_at
  if (syncedAt != null && Date.now() - syncedAt < COOLDOWN_MS) return null

  const run = (async () => {
    // Stamped before the work, not after: a sync that fails should wait out the
    // cooldown like any other, or a member whose feed has gone private would
    // have every page load retry the fetch.
    await db.update(users, user.id, { letterboxd_synced_at: Date.now() })
    await syncLetterboxdDiary(db, user.id, username)
  })()
    .catch((error) => {
      // Nothing here is on a response, so there is nobody to tell — but an
      // unhandled rejection takes the process down, and a member who connected
      // an account deserves better than silence in the log.
      console.error(`Letterboxd sync failed for user ${user.id}:`, error)
    })
    .finally(() => {
      inFlight.delete(user.id)
    })

  inFlight.set(user.id, run)
  return run
}

// Fire-and-forget, for a page that only needs the log to be current the next
// time it is looked at. Never awaited on a render: a feed fetch plus a detail
// lookup per new film does not belong on the response path.
export function syncLetterboxdInBackground(db: Db, user: User): void {
  void startSync(db, user)
}

// For a caller that would rather not act on a stale log — a recommendation run
// generating against films the member already watched. Bounded, because a slow
// feed is not a reason to fail the thing the member actually asked for; the
// sync carries on in the background either way.
export async function syncLetterboxdBeforeRun(db: Db, user: User): Promise<void> {
  const run = startSync(db, user)
  if (!run) return

  await Promise.race([run, new Promise((resolve) => setTimeout(resolve, WAIT_MS).unref())])
}
