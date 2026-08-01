// The denormalized blob stored on media_items.metadata. Every field parses
// back as null when absent, so widening this never needs a migration — rows
// written before a field existed just read as null.
export interface MediaMetadata {
  releaseYear: number | null
  posterUrl: string | null
  overview: string | null
  // Films and episodes. Null for media measured some other way.
  runtimeMinutes: number | null
  // Books/comics — the length dimension that stands in for runtime.
  pageCount: number | null
  // The person most associated with the work: director for film, creator
  // for TV, author for a book. One field rather than three, since only one
  // is ever meaningful per type — MEDIA_TYPE_UI.creditLabel names it.
  creator: string | null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function parseMediaMetadata(metadata: string): MediaMetadata {
  try {
    const parsed = JSON.parse(metadata) as Partial<MediaMetadata>
    return {
      releaseYear: numberOrNull(parsed.releaseYear),
      posterUrl: stringOrNull(parsed.posterUrl),
      overview: stringOrNull(parsed.overview),
      runtimeMinutes: numberOrNull(parsed.runtimeMinutes),
      pageCount: numberOrNull(parsed.pageCount),
      creator: stringOrNull(parsed.creator),
    }
  } catch {
    return {
      releaseYear: null,
      posterUrl: null,
      overview: null,
      runtimeMinutes: null,
      pageCount: null,
      creator: null,
    }
  }
}
