// The blob stored on media_items.metadata. Every field parses back as null when
// absent, so widening it never needs a migration.
export interface MediaMetadata {
  releaseYear: number | null
  posterUrl: string | null
  overview: string | null
  // Films and episodes.
  runtimeMinutes: number | null
  // Books.
  pageCount: number | null
  // Games — hours to beat.
  playtimeHours: number | null
  // Director, creator or author — one field, since only one is meaningful per
  // type. MEDIA_TYPE_UI.creditLabel names it.
  creator: string | null
  // Additional artwork, in display order. Empty rather than null, so callers
  // can map it without a guard.
  images: string[]
  // Games — short abbreviations.
  platforms: string[]
  // Lowercased genre labels from the source catalog. Covered by the GIN index
  // on this column, so `metadata @> '{"tags":["horror"]}'` avoids a scan.
  tags: string[]
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
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
    creator: null,
    images: [],
    platforms: [],
    tags: [],
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
      creator: stringOrNull(parsed.creator),
      images: stringArray(parsed.images),
      platforms: stringArray(parsed.platforms),
      tags: stringArray(parsed.tags),
    }
  } catch {
    return emptyMetadata()
  }
}
