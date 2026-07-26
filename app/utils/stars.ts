export const RATING_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

export function formatStars(value: number): string {
  const fullStars = Math.floor(value)
  const hasHalf = value - fullStars >= 0.5
  return '★'.repeat(fullStars) + (hasHalf ? '☆' : '')
}

// Clamps to 0.5-5 in half-star steps, defensively — the <select> only offers
// valid values, but the request could be tampered with.
export function parseRatingInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !Number.isFinite(Number(trimmed))) return null
  return Math.min(5, Math.max(0.5, Math.round(Number(trimmed) * 2) / 2))
}
