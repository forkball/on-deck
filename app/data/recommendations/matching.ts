import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, type CatalogSearchResult, type LengthBucket } from '../catalog/provider.ts'
import { pool } from '../db.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import type { MediaType } from '../mediaItems.ts'
import { requestStructured } from './claude.ts'
import { GenerationError } from './errors.ts'
import type { DecadeRelation, Pick } from './picks.ts'
import { track } from './timings.ts'

export interface Candidate {
  pick: Pick
  match: CatalogSearchResult
}

// These two are every outbound catalog request the pipeline makes, so timing
// them here covers all of it.
function searchForType(mediaType: MediaType, query: string): Promise<CatalogSearchResult[]> {
  return track('catalog.search', () => getCatalogProvider(mediaType).search(query))
}

function lookupForType(mediaType: MediaType, externalId: string): Promise<CatalogSearchResult | null> {
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

// Lenient on purpose — verifyPicksAgainstOverviews is what catches a
// same-title-same-year-different-film.
const TITLE_SIMILARITY_THRESHOLD = 0.5

// Strips at the separator rather than allowing a prefix match: "Foundation" is a
// prefix of "Foundation and Empire", a different novel.
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

// Each verdict carries the index of the entry it's about, so answers pair up by
// id rather than by position — a verdict list one short would otherwise slide
// every answer after it onto the wrong film.
//
// The schema can't pin the array's length: structured output only accepts 0 or
// 1 for minItems, and a larger one fails the request outright (`400 ...
// 'minItems' values other than 0 or 1 are not supported`). applyVerdicts is
// what holds the model to one verdict per entry.
const VERIFY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array' as const,
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

export interface PickVerdict {
  index: number
  matches: boolean
}

// Refuses anything it can't read unambiguously rather than filtering on a best
// guess: a verdict set that doesn't line up means we don't know which film each
// answer was about.
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

// Two audiences: GenerationError carries a message to the waiting page (see
// errors.ts), and the detail that would only puzzle them goes to the log.
function mismatch(detail: string): GenerationError {
  console.warn(`[generation] verification mismatch: ${detail}`)
  return new GenerationError('Checking the picks came back incomplete — try generating again.')
}

// A same-title-same-year-different-film sails through titlesLikelyMatch, since
// only the plot can tell them apart. One batched call for the whole list.
export async function verifyPicksAgainstOverviews(
  candidates: Candidate[],
  mediaType: MediaType = 'movie',
): Promise<Candidate[]> {
  if (candidates.length === 0) return []

  // From the registry — this prompt's whole job is telling similar entries
  // apart, so it has to name the catalog the entry actually came from.
  const { plural: noun, entryNoun, catalogName } = mediaTypeUiFor(mediaType)

  const items = candidates.map(({ pick, match }, index) => ({
    index,
    you_suggested: { title: pick.title, year: pick.year, your_reason: pick.reason },
    catalog_found: { title: match.title, year: match.releaseYear, overview: match.overview },
  }))

  const { verdicts } = await requestStructured<{ verdicts: PickVerdict[] }>('verify.model', {
    model: 'claude-sonnet-5',
    // Shared with the reasoning, as everywhere else. The verdicts themselves are
    // tiny — an index and a boolean each — but the judgement behind them is one
    // plot read against one title per entry.
    max_tokens: 6000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: VERIFY_SCHEMA },
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
  })
  return applyVerdicts(candidates, verdicts)
}

// Shared by every provider fan-out below — one ceiling, not several that drift
// apart.
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

export type CatalogSearch = (mediaType: MediaType, query: string) => Promise<CatalogSearchResult[]>

// One search per pick the local catalog didn't already answer for, through the
// same pool as the by-id fan-outs. `Promise.all` over the picks put all of them
// on the wire at once — 18 on a filtered run, which asks for six extra — and
// that is the burst that gets Google Books answering 503 and Open Library, which
// resets connections at the best of times, resetting most of them. One of those
// throwing took the whole run with it, after the picks had already been paid for.
//
// A search that fails is a pick nothing was found for, which the caller already
// counts and drops. Every search failing is not 18 unfindable titles, it's the
// catalog being unreachable, so say that rather than save a run with nothing in
// it — unless the local catalog answered for some, in which case there is still
// a run to make.
export async function searchForPicks(
  mediaType: MediaType,
  picks: Pick[],
  fromCatalog: Map<number, CatalogSearchResult>,
  search: CatalogSearch = searchForType,
): Promise<CatalogSearchResult[][]> {
  const matches: CatalogSearchResult[][] = picks.map((_, index) => {
    const local = fromCatalog.get(index)
    return local ? [local] : []
  })
  const toSearch = picks.map((_, index) => index).filter((index) => !fromCatalog.has(index))
  let failed = 0

  await forEachWithConcurrency(toSearch, async (index) => {
    try {
      matches[index] = await search(mediaType, picks[index].title)
    } catch (error) {
      failed++
      console.warn(`[generation] ${mediaType} search failed for ${JSON.stringify(picks[index].title)}:`, error)
    }
  })

  if (failed > 0 && failed === toSearch.length && fromCatalog.size === 0) {
    throw new GenerationError(
      `Couldn't look up any of the picks — the catalog isn't answering right now. ` +
        `Try generating again in a few minutes.`,
    )
  }

  return matches
}

// A by-id lookup that answers null rather than throwing. A provider is a
// third party having a bad day — Google Books answers 429 once the quota for
// the day is gone, and a book row imported through the Open Library fallback
// carries an id Google Books was never going to resolve — and one such answer
// is a verdict about one candidate, not grounds to fail a run that has already
// paid for its picks. Callers below decide what a missing answer means.
export type CatalogLookup = (mediaType: MediaType, externalId: string) => Promise<CatalogSearchResult | null>

async function lookupQuietly(
  lookup: CatalogLookup,
  mediaType: MediaType,
  externalId: string,
): Promise<CatalogSearchResult | null> {
  try {
    return await lookup(mediaType, externalId)
  } catch (error) {
    console.warn(`[generation] ${mediaType} lookup failed for ${externalId}:`, error)
    return null
  }
}

// TMDB returns descriptions on search; Open Library only on the per-work record.
// Without one, verifyPicksAgainstOverviews rubber-stamps every book.
export async function withOverviews(
  candidates: Candidate[],
  mediaType: MediaType,
  lookup: CatalogLookup = lookupForType,
): Promise<Candidate[]> {
  const missing = candidates.filter(({ match }) => !match.overview)
  if (missing.length === 0) return candidates

  await forEachWithConcurrency(missing, async (entry) => {
    const detail = await lookupQuietly(lookup, mediaType, entry.match.externalId)
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
// the lever is set at all. The fan-out is bounded, not serial.
export async function filterByLength(
  candidates: Candidate[],
  mediaType: MediaType,
  length: LengthBucket,
  lookup: CatalogLookup = lookupForType,
): Promise<Candidate[]> {
  const provider = getCatalogProvider(mediaType)

  // The stored row often already carries the dimension.
  const needLookup = new Set(candidates.filter(({ match }) => !hasLengthDimension(mediaType, match)))
  // Null marks a lookup that answered nothing: no dimension, no verdict, so it
  // can't be kept. Held beside the entry so the filter below stays a pure read.
  const resolved = new Map<Candidate, CatalogSearchResult | null>()

  await forEachWithConcurrency([...needLookup], async (entry) => {
    resolved.set(entry, await lookupQuietly(lookup, mediaType, entry.match.externalId))
  })

  const kept: Candidate[] = []
  for (const entry of candidates) {
    if (!needLookup.has(entry)) {
      if (provider.matchesLength(entry.match, length)) kept.push(entry)
      continue
    }

    const detail = resolved.get(entry) ?? null
    if (!detail || !provider.matchesLength(detail, length)) continue
    // The detail result, not the search one: it carries the dimension that was
    // just paid for, which search omits.
    kept.push({ pick: entry.pick, match: detail })
  }

  // Dropping one candidate the provider wouldn't answer for is the rule working.
  // Dropping every one of them, with nothing left that carried the dimension
  // already, is the provider being down — and a run saved from that is an empty
  // page reading as "nothing matched your length", which is a different and
  // untrue thing. Say so instead.
  if (kept.length === 0 && needLookup.size > 0 && [...resolved.values()].every((detail) => detail == null)) {
    throw new GenerationError(
      `Couldn't check the length of any of the ${mediaTypeUiFor(mediaType).plural} — the catalog isn't ` +
        `answering right now. Try generating again in a few minutes.`,
    )
  }

  return kept
}

const YEAR_TOLERANCE = 1

// Resolves picks against the catalog we already hold, so a provider is only
// asked about titles we've never seen (~21% of picks are already there).
//
// The match is tight on purpose: normalised title equality *and* release year
// within one, since a looser rule confuses same-titled works from different eras
// (Dune 1984 and 2021).
//
// A row with no overview counts as a miss — verifyPicksAgainstOverviews judges
// on plot text, so skipping the provider would skip the only check that catches
// a wrong match. Only ~12% of books carry one.
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
