export interface MovieMetadata {
  releaseYear: number | null
  posterUrl: string | null
  overview: string | null
}

export function parseMovieMetadata(metadata: string): MovieMetadata {
  try {
    const parsed = JSON.parse(metadata) as Partial<MovieMetadata>
    return {
      releaseYear: typeof parsed.releaseYear === 'number' ? parsed.releaseYear : null,
      posterUrl: typeof parsed.posterUrl === 'string' ? parsed.posterUrl : null,
      overview: typeof parsed.overview === 'string' ? parsed.overview : null,
    }
  } catch {
    return { releaseYear: null, posterUrl: null, overview: null }
  }
}
