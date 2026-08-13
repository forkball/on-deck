import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, type CatalogSearchResult, type LengthBucket } from '../catalog/provider.ts'
import { pool } from '../db.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import type { MediaType } from '../mediaItems.ts'
import { claude, parseStructuredResponse } from './claude.ts'
import type { DecadeRelation, Pick } from './picks.ts'
import { track } from './timings.ts'

// A pick paired with the catalog entry it resolved to.
export interface Candidate {
  pick: Pick
  match: CatalogSearchResult
}

// Via the registry, so an unserved type throws rather than quietly returning
// film results for a book request.
//
// Timed here rather than at each call site: these two are every outbound
// catalog request the pipeline makes, and which phase was open when one ran is
// what says whether it was a length check or an overview fetch.
export function searchForType(mediaType: MediaType, query: string): Promise<CatalogSearchResult[]> {
  return track('catalog.search', () => getCatalogProvider(mediaType).search(query))
}

export function lookupForType(mediaType: MediaType, externalId: string): Promise<CatalogSearchResult | null> {
  return track('catalog.lookup', () => getCatalogProvider(mediaType).getById(externalId))
}

export function matchesDecade(releaseYear: number | null, decade: number, relation: DecadeRelation = 'within'): boolean {
  if (releaseYear == null) return false
  if (relation === 'before') return releaseYear < decade
  if (relation === 'after') return releaseYear >= decade + 10
  return releaseYear >= decade && releaseYear < decade + 10
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// Lenient on purpose: real catalog titles differ from a natural-language ask in
// punctuation, "the"/no "the", or translation. Catches "wrong film entirely";
// verifyPicksAgainstOverviews catches same-title-same-year-different-film.
const TITLE_SIMILARITY_THRESHOLD = 0.5

// Catalog titles often carry a subtitle the pick didn't ask for — "The
// Dispossessed: An Ambiguous Utopia" scores 0.44 and was dropped despite being
// an exact match. Books hit this constantly, since Open Library joins the two.
//
// Strips at the separator rather than allowing a prefix match: "Foundation" is
// a prefix of "Foundation and Empire", a different novel. A colon is a
// structural marker; a space isn't.
function withoutSubtitle(title: string): string {
  const [main] = title.split(/\s*[:–—]\s*/)
  return normalizeTitle(main ?? title)
}

export function titlesLikelyMatch(pickTitle: string, foundTitle: string): boolean {
  const a = normalizeTitle(pickTitle)
  const b = normalizeTitle(foundTitle)
  if (!a || !b) return false
  if (a === b) return true
  if (a === withoutSubtitle(foundTitle) || withoutSubtitle(pickTitle) === b) return true

  const distance = levenshteinDistance(a, b)
  const similarity = 1 - distance / Math.max(a.length, b.length)
  return similarity >= TITLE_SIMILARITY_THRESHOLD
}

// Each verdict carries the entry it's about. The bare boolean array this
// replaced was paired with its candidate by position, which is an assumption
// dressed up as data: one verdict too few and every answer after it slid onto
// the wrong film — keeping one the model had rejected and dropping one it had
// approved, at the single step whose job is telling near-identical entries
// apart, with nothing anywhere reporting it.
//
// Built per call so the length can be pinned. Nothing in JSON Schema can say
// "as many as I sent you", but a count known at call time can.
function verifySchema(count: number) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      verdicts: {
        type: 'array' as const,
        minItems: count,
        maxItems: count,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            index: { type: 'number' as const },
            matches: { type: 'boolean' as const },
          },
          required: ['index', 'matches'],
        },
      },
    },
    required: ['verdicts'],
  }
}

export interface PickVerdict {
  index: number
  matches: boolean
}

// Split out from the call because this is the half that can be wrong while
// everything still looks fine — and the half that needs no model to test.
//
// Refuses anything it can't read unambiguously rather than filtering on a
// best guess. A verdict set that doesn't line up means we don't know which
// film each answer was about, and quietly keeping whatever happened to be
// true would be the same silent mismatch in a new costume. The job retries,
// and the picks it already paid for are in the checkpoint.
export function applyVerdicts(candidates: Candidate[], verdicts: PickVerdict[]): Candidate[] {
  if (!Array.isArray(verdicts)) throw mismatch(`verdicts came back as ${typeof verdicts}`)

  const byIndex = new Map<number, boolean>()

  for (const { index, matches } of verdicts) {
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      throw mismatch(`verdict for entry ${index}, which wasn't among the ${candidates.length} asked about`)
    }
    if (byIndex.has(index)) throw mismatch(`two verdicts for entry ${index}`)
    byIndex.set(index, matches)
  }

  if (byIndex.size !== candidates.length) {
    throw mismatch(`${byIndex.size} of ${candidates.length} entries answered`)
  }

  return candidates.filter((_, index) => byIndex.get(index) === true)
}

// Two audiences. The message travels to the waiting page verbatim (worker.ts
// hands error.message to failJob), so it says what to do about it; the detail
// that would only puzzle someone there goes to the log.
function mismatch(detail: string): Error {
  console.warn(`[generation] verification mismatch: ${detail}`)
  return new Error('Checking the picks came back incomplete — try generating again.')
}

// A same-title-same-year-different-film sails through titlesLikelyMatch, since
// only the plot can tell them apart. Asks Claude, which knows what it meant, to
// confirm against the catalog's overview — one batched call for the list.
export async function verifyPicksAgainstOverviews(
  candidates: Candidate[],
  mediaType: MediaType = 'movie',
): Promise<Candidate[]> {
  if (candidates.length === 0) return []

  // From the registry: a hardcoded "TMDB" told Claude the wrong source for
  // games, inside the one prompt whose job is telling similar things apart.
  const { plural: noun, entryNoun, catalogName } = mediaTypeUiFor(mediaType)

  const items = candidates.map(({ pick, match }, index) => ({
    index,
    you_suggested: { title: pick.title, year: pick.year, your_reason: pick.reason },
    catalog_found: { title: match.title, year: match.releaseYear, overview: match.overview },
  }))

  const response = await track('verify.model', () =>
    claude.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: verifySchema(candidates.length) },
      },
      messages: [
        {
          role: 'user',
          content:
            `You previously suggested some ${noun} by title/year. For each one, we looked it up on ${catalogName} and found ` +
            `a specific ${entryNoun} — here's what ${catalogName} returned, described by its own title, year, and plot ` +
            `overview. Confirm whether the ${entryNoun} found is truly the same one you meant, not just a ` +
            `similarly- or identically-titled different one. Small title differences (translation, punctuation, ` +
            `"the" vs no "the") are fine as long as it's the same ${entryNoun}.\n\n${JSON.stringify(items, null, 2)}\n\n` +
            `Return one verdict per entry, each repeating that entry's "index" from above, with "matches" true ` +
            `only if the ${entryNoun} found is genuinely the one you meant. Every entry needs exactly one ` +
            `verdict — order doesn't matter, since the index is what pairs them up.`,
        },
      ],
    }),
  )

  const { verdicts } = parseStructuredResponse<{ verdicts: PickVerdict[] }>(response)
  return applyVerdicts(candidates, verdicts)
}

// Same bound as the Letterboxd importer's. Shared by both by-id fan-outs
// below, since both are the same provider being asked the same kind of
// question — one ceiling, not two that drift apart.
const LOOKUP_CONCURRENCY = 8

// A worker pool rather than Promise.all: these run against a rate-limited
// provider, and a run can carry 25 picks.
async function forEachWithConcurrency<T>(items: T[], operation: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      await operation(items[next++])
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, items.length) }, worker))
}

// TMDB returns descriptions on search; Open Library only on the per-work
// record. Since verifyPicksAgainstOverviews reads them, a missing one would
// make it rubber-stamp every book.
export async function withOverviews(candidates: Candidate[], mediaType: MediaType): Promise<Candidate[]> {
  const missing = candidates.filter(({ match }) => !match.overview)
  if (missing.length === 0) return candidates

  await forEachWithConcurrency(missing, async (entry) => {
    const detail = await lookupForType(mediaType, entry.match.externalId)
    if (detail?.overview) entry.match = { ...entry.match, overview: detail.overview }
  })

  return candidates
}

// Whether the by-id lookup can be skipped.
export function hasLengthDimension(mediaType: MediaType, result: CatalogSearchResult): boolean {
  if (mediaType === 'book') return result.pageCount != null
  if (mediaType === 'game') return result.playtimeHours != null
  if (mediaType === 'tv') return result.seasonCount != null
  return result.runtimeMinutes != null
}

// Keeps only the candidates matching the requested length, fetching the
// dimension for the ones whose search result didn't carry it.
//
// No provider returns length on search, only on by-id, so this is a second
// round of requests — but only for the candidates that need it, and only when
// the lever is set at all. It used to run inside the filter loop, which made
// it one request at a time: up to 25 round trips end to end, in the stage the
// waiting page labels "Checking lengths…".
export async function filterByLength(
  candidates: Candidate[],
  mediaType: MediaType,
  length: LengthBucket,
): Promise<Candidate[]> {
  const provider = getCatalogProvider(mediaType)

  // The stored row often already carries the dimension, making the request
  // pure cost.
  const needLookup = new Set(candidates.filter(({ match }) => !hasLengthDimension(mediaType, match)))
  // Null marks a candidate whose lookup failed — no dimension, no verdict, so
  // it can't be kept. Held beside the entry rather than mutated into it so the
  // filter below stays a pure read.
  const resolved = new Map<Candidate, CatalogSearchResult | null>()

  await forEachWithConcurrency([...needLookup], async (entry) => {
    resolved.set(entry, await lookupForType(mediaType, entry.match.externalId))
  })

  const kept: Candidate[] = []
  for (const entry of candidates) {
    if (!needLookup.has(entry)) {
      if (provider.matchesLength(entry.match, length)) kept.push(entry)
      continue
    }

    const detail = resolved.get(entry) ?? null
    if (!detail || !provider.matchesLength(detail, length)) continue
    // Already paid for, and it carries what search omits. Keeping the search
    // result instead wrote rows with a null runtime it had just fetched.
    kept.push({ pick: entry.pick, match: detail })
  }

  return kept
}

const YEAR_TOLERANCE = 1

// Resolves picks against the catalog we already hold, so a provider is only
// asked about titles we've never seen — 21% of picks written so far were
// already there, and that share grows as the catalog fills.
//
// The match is tight on purpose: normalised title equality *and* release year
// within one. Same-titled works from different eras (Dune 1984 and 2021) are
// exactly what a looser rule confuses, and one year never spans them.
//
// A row with no overview counts as a miss, since verifyPicksAgainstOverviews
// judges on plot text and skipping the provider would skip the only check that
// catches a wrong match. Books hit this constantly — 12% carry an overview.
//
// Raw SQL because the normalisation has to happen in the database. Matches
// normalizeTitle exactly.
export async function resolveFromCatalog(
  mediaType: MediaType,
  picks: Pick[],
): Promise<Map<number, CatalogSearchResult>> {
  const resolved = new Map<number, CatalogSearchResult>()
  if (picks.length === 0) return resolved

  const wanted = picks.map((pick) => normalizeTitle(pick.title))

  // Timed alongside the provider calls it exists to avoid, so the saving is
  // legible rather than assumed.
  const { rows } = await track('catalog.local', () =>
    pool.query<{
      id: number
      external_id: string
      title: string
      metadata: string
      popularity_score: number | null
      normalized: string
    }>(
      `select id, external_id, title, metadata, popularity_score,
            btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9[:space:]]', '', 'g'), '\\s+', ' ', 'g')) as normalized
       from media_items
      where type = $1
        and btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9[:space:]]', '', 'g'), '\\s+', ' ', 'g')) = any($2)`,
      [mediaType, wanted],
    ),
  )
  if (rows.length === 0) return resolved

  const byTitle = new Map<string, typeof rows>()
  for (const row of rows) {
    byTitle.set(row.normalized, [...(byTitle.get(row.normalized) ?? []), row])
  }

  for (const [index, pick] of picks.entries()) {
    const candidates = byTitle.get(normalizeTitle(pick.title))
    if (!candidates) continue

    for (const row of candidates) {
      const metadata = parseMediaMetadata(row.metadata)
      if (metadata.releaseYear == null) continue
      if (Math.abs(metadata.releaseYear - pick.year) > YEAR_TOLERANCE) continue
      // No overview, no verification — so no shortcut.
      if (!metadata.overview) continue

      resolved.set(index, {
        externalId: row.external_id,
        title: row.title,
        releaseYear: metadata.releaseYear,
        tags: metadata.tags,
        posterUrl: metadata.posterUrl,
        popularity: Number(row.popularity_score ?? 0),
        overview: metadata.overview,
        runtimeMinutes: metadata.runtimeMinutes,
        pageCount: metadata.pageCount,
        playtimeHours: metadata.playtimeHours,
        seasonCount: metadata.seasonCount,
        creator: metadata.creator,
        images: metadata.images,
        platforms: metadata.platforms,
      })
      break
    }
  }

  return resolved
}
