import type { User } from '../schema.ts'

// Letterboxd publishes every member's diary as public RSS, with no auth and no
// API key. What makes it worth reading over the CSV export is `tmdb:movieId`:
// the export carries only a title and year, so `matchMovie` has to search for
// it and can land on the wrong film, while a feed entry names the film outright.
const FEED_BASE = 'https://letterboxd.com'

// Letterboxd member names are lowercase alphanumerics and underscores. Checked
// before it reaches a URL, so a name can't steer the request somewhere else.
const USERNAME_PATTERN = /^[a-z0-9_]{1,32}$/

const FEED_TIMEOUT_MS = 10_000

// Off for everyone unless switched on, the same way EXPERIMENTAL_MEDIA_TYPES
// is: a forgotten variable should hide the feature rather than ship it.
//
// Read per call rather than captured at import: a test can set it, and the
// value is only ever consulted off the hot path.
export function isLetterboxdSyncEnabled(): boolean {
  const flag = (process.env.LETTERBOXD_FEED_SYNC ?? '').trim().toLowerCase()
  // Named values only. "Any non-empty string" would make LETTERBOXD_FEED_SYNC=0
  // turn the feature on, which is the opposite of what anyone writing that means.
  return flag === '1' || flag === 'true'
}

// The gate everything actually asks, and the only one worth calling: the env
// flag opens the feature to everyone, and an admin has it either way, so it can
// be exercised against production before it is turned on for everyone.
//
// Admin is otherwise a maintenance role — today it only lifts the daily
// recommendation cap — so this does lean on it for something it wasn't invented
// for. It is the narrowest gate that already exists, has no UI, and is granted
// only by scripts/set-admin.ts, which is exactly the shape a beta needs.
//
// Gating here rather than only in the UI keeps it a real switch: with it closed
// there are no outbound requests, and an already-connected member's username
// stays on their row, dormant, until it opens again.
export function letterboxdSyncAvailableTo(user: Pick<User, 'is_admin'>): boolean {
  return isLetterboxdSyncEnabled() || user.is_admin
}

export interface LetterboxdEntry {
  // TMDB's own id, straight from the feed — no title search, no year tiebreak.
  tmdbId: string
  title: string
  year: number | null
  // Null where the member logged a watch without rating it.
  rating: number | null
  watchedAt: number | null
  // Only a review entry carries one. A plain watch entry's description is a
  // poster image and the sentence "Watched on Saturday August 22, 2026." —
  // boilerplate, not something anyone wrote.
  notes: string | null
}

export type LetterboxdFeedOutcome =
  | { ok: true; entries: LetterboxdEntry[] }
  | { ok: false; reason: 'not-found' | 'unavailable'; message: string }

export function normalizeLetterboxdUsername(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  return USERNAME_PATTERN.test(trimmed) ? trimmed : null
}

export function letterboxdFeedUrl(username: string): string {
  return `${FEED_BASE}/${encodeURIComponent(username)}/rss/`
}

// Letterboxd answers 404 for a member who doesn't exist and for one whose
// account is private, with nothing to tell them apart — so `not-found` covers
// both and the wording at the call site has to name both possibilities.
export async function fetchLetterboxdFeed(username: string): Promise<LetterboxdFeedOutcome> {
  let response: Response
  try {
    response = await fetch(letterboxdFeedUrl(username), {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    })
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      message: "Couldn't reach Letterboxd just now. Try again shortly.",
    }
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: 'not-found',
      message:
        "We couldn't find a public Letterboxd profile with that username. Check the spelling — private accounts don't publish a feed.",
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'unavailable',
      message: `Letterboxd returned ${response.status}. Try again shortly.`,
    }
  }

  return { ok: true, entries: parseLetterboxdFeed(await response.text()) }
}

const ITEM_PATTERN = /<item>([\s\S]*?)<\/item>/g

// The feed is not all diary entries: it carries the member's lists too, at
// roughly one list per diary entry. A list has no film attached to it — no
// tmdb id, no watched date — so the guid is what sorts them out.
const REVIEW_GUID = /<guid[^>]*>letterboxd-review-/
const WATCH_GUID = /<guid[^>]*>letterboxd-watch-/

export function parseLetterboxdFeed(xml: string): LetterboxdEntry[] {
  const entries: LetterboxdEntry[] = []

  for (const [, item] of xml.matchAll(ITEM_PATTERN)) {
    const isReview = REVIEW_GUID.test(item)
    if (!isReview && !WATCH_GUID.test(item)) continue

    // Belt and braces with the guid check: an entry with no film id is nothing
    // this can log, whatever it claims to be.
    const tmdbId = tag(item, 'tmdb:movieId')
    if (!tmdbId) continue

    const title = tag(item, 'letterboxd:filmTitle')
    if (!title) continue

    entries.push({
      tmdbId,
      title,
      year: numberOrNull(tag(item, 'letterboxd:filmYear')),
      rating: numberOrNull(tag(item, 'letterboxd:memberRating')),
      watchedAt: watchedAt(tag(item, 'letterboxd:watchedDate')),
      notes: isReview ? reviewText(item) : null,
    })
  }

  return entries
}

function tag(item: string, name: string): string | null {
  // Escaped because every name here contains a `:`, which is fine in a regex
  // but the names are interpolated and shouldn't have to be trusted.
  const pattern = new RegExp(`<${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>([\\s\\S]*?)</`)
  const match = item.match(pattern)
  if (!match) return null
  const value = decodeEntities(match[1]!).trim()
  return value === '' ? null : value
}

function numberOrNull(raw: string | null): number | null {
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

// `2026-09-03`, which Date.parse reads as UTC midnight — deliberately, so the
// stored day doesn't shift with the server's zone.
function watchedAt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const CDATA_PATTERN = /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/
// Every description opens with the poster, review or not.
const LEADING_POSTER = /^\s*<p>\s*<img[^>]*>\s*<\/p>/

function reviewText(item: string): string | null {
  const match = item.match(CDATA_PATTERN)
  if (!match) return null

  const text = decodeEntities(
    match[1]!
      .replace(LEADING_POSTER, '')
      // Paragraph breaks are the only structure worth keeping; everything else
      // becomes plain text.
      .replace(/<\/p>\s*<p>/g, '\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text === '' ? null : text
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return codePoint(Number.parseInt(code.slice(2), 16), whole)
    }
    if (code.startsWith('#')) {
      return codePoint(Number.parseInt(code.slice(1), 10), whole)
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole
  })
}

// An unrecognised or out-of-range reference is left as it was written rather
// than turned into a replacement character.
function codePoint(value: number, whole: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return whole
  try {
    return String.fromCodePoint(value)
  } catch {
    return whole
  }
}
