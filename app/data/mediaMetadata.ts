export interface CastMember {
  name: string
  character: string | null
}

// The blob stored on media_items.metadata. Every field parses back as null when
// absent, so widening it never needs a migration.
export interface MediaMetadata {
  releaseYear: number | null
  posterUrl: string | null
  overview: string | null
  runtimeMinutes: number | null
  pageCount: number | null
  playtimeHours: number | null
  seasonCount: number | null
  creator: string | null
  // The names `creator` joins, when a provider gives more than one. Empty
  // otherwise, in which case `creator` is the whole answer.
  creators: string[]
  // Top-billed first. Movies only, and only once a detail lookup has landed.
  cast: CastMember[]
  tagline: string | null
  // The catalog page, when it can't be built from external_id — see
  // catalogPageFor, which is what reads it.
  sourceUrl: string | null
  images: string[]
  platforms: string[]
  // What the provider called the series this belongs to. Empty for a medium whose
  // catalog doesn't say — see CatalogSearchResult.series.
  series: string[]
  // Lowercased genre labels from the source catalog. Covered by the GIN index
  // on this column, so `metadata @> '{"tags":["horror"]}'` avoids a scan.
  tags: string[]
  // When a by-id detail lookup was last applied, or null if one never has been.
  //
  // Records the *attempt*, not its yield, which is the whole point: the fields
  // a detail lookup fills in (creator, runtimeMinutes) are legitimately absent
  // upstream for plenty of entries, so treating "still null" as "never tried"
  // re-requested them on every single view. TV was worst hit — TMDB leaves
  // `created_by` empty for a lot of shows and `episode_run_time` empty for most
  // modern ones, so those two together never became non-null and the lookup
  // repeated forever.
  enrichedAt: number | null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function castList(value: unknown): CastMember[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { name, character } = entry as { name?: unknown; character?: unknown }
    return typeof name === 'string' ? [{ name, character: stringOrNull(character) }] : []
  })
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// Fresh each time — a shared constant would hand every caller the same arrays.
function emptyMetadata(): MediaMetadata {
  return {
    releaseYear: null,
    posterUrl: null,
    overview: null,
    runtimeMinutes: null,
    pageCount: null,
    playtimeHours: null,
    seasonCount: null,
    creator: null,
    creators: [],
    cast: [],
    tagline: null,
    sourceUrl: null,
    images: [],
    platforms: [],
    series: [],
    tags: [],
    enrichedAt: null,
  }
}

// `unknown` because the column is jsonb and pg hands back a parsed object; the
// string branch stays for raw SQL callers.
export function parseMediaMetadata(metadata: unknown): MediaMetadata {
  try {
    const parsed = (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) as
      | Partial<MediaMetadata>
      | null
      | undefined
    if (!parsed || typeof parsed !== 'object') return emptyMetadata()

    return {
      releaseYear: numberOrNull(parsed.releaseYear),
      posterUrl: stringOrNull(parsed.posterUrl),
      overview: stringOrNull(parsed.overview),
      runtimeMinutes: numberOrNull(parsed.runtimeMinutes),
      pageCount: numberOrNull(parsed.pageCount),
      playtimeHours: numberOrNull(parsed.playtimeHours),
      seasonCount: numberOrNull(parsed.seasonCount),
      creator: stringOrNull(parsed.creator),
      creators: stringArray(parsed.creators),
      cast: castList(parsed.cast),
      tagline: stringOrNull(parsed.tagline),
      sourceUrl: stringOrNull(parsed.sourceUrl),
      images: stringArray(parsed.images),
      platforms: stringArray(parsed.platforms),
      series: stringArray(parsed.series),
      tags: stringArray(parsed.tags),
      enrichedAt: numberOrNull(parsed.enrichedAt),
    }
  } catch {
    return emptyMetadata()
  }
}
