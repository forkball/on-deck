import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, type CatalogSearchResult } from '../catalog/provider.ts'
import { pool } from '../db.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import type { MediaType } from '../mediaItems.ts'
import { claude, parseStructuredResponse } from './claude.ts'
import type { Pick } from './picks.ts'

// A pick paired with the catalog entry it resolved to.
export interface Candidate {
  pick: Pick
  match: CatalogSearchResult
}

// Via the registry, so an unserved type throws rather than quietly returning
// film results for a book request.
export function searchForType(mediaType: MediaType, query: string): Promise<CatalogSearchResult[]> {
  return getCatalogProvider(mediaType).search(query)
}

export function lookupForType(mediaType: MediaType, externalId: string): Promise<CatalogSearchResult | null> {
  return getCatalogProvider(mediaType).getById(externalId)
}

export function matchesDecade(releaseYear: number | null, decade: number): boolean {
  return releaseYear != null && releaseYear >= decade && releaseYear < decade + 10
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

const VERIFY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    verdicts: { type: 'array' as const, items: { type: 'boolean' as const } },
  },
  required: ['verdicts'],
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

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
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
          `Return one boolean per entry, in the same order as given, true only if the ${entryNoun} found is ` +
          `genuinely the one you meant.`,
      },
    ],
  })

  const { verdicts } = parseStructuredResponse<{ verdicts: boolean[] }>(response)
  return candidates.filter((_, index) => verdicts[index] === true)
}

// Same bound as the Letterboxd importer's.
const OVERVIEW_CONCURRENCY = 8

// TMDB returns descriptions on search; Open Library only on the per-work
// record. Since verifyPicksAgainstOverviews reads them, a missing one would
// make it rubber-stamp every book.
export async function withOverviews(candidates: Candidate[], mediaType: MediaType): Promise<Candidate[]> {
  const missing = candidates.filter(({ match }) => !match.overview)
  if (missing.length === 0) return candidates

  let next = 0
  async function worker() {
    while (next < missing.length) {
      const entry = missing[next++]
      const detail = await lookupForType(mediaType, entry.match.externalId)
      if (detail?.overview) entry.match = { ...entry.match, overview: detail.overview }
    }
  }
  await Promise.all(Array.from({ length: Math.min(OVERVIEW_CONCURRENCY, missing.length) }, worker))

  return candidates
}

// Whether the by-id lookup can be skipped.
export function hasLengthDimension(mediaType: MediaType, result: CatalogSearchResult): boolean {
  if (mediaType === 'book') return result.pageCount != null
  if (mediaType === 'game') return result.playtimeHours != null
  return result.runtimeMinutes != null
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

  const { rows } = await pool.query<{
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
        creator: metadata.creator,
        images: metadata.images,
        platforms: metadata.platforms,
      })
      break
    }
  }

  return resolved
}
