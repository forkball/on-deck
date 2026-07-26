// Clamps to 0.5-5 in half-star steps, defensively — the star picker only
// submits valid values, but the request could be tampered with.
export function parseRatingInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !Number.isFinite(Number(trimmed))) return null
  return Math.min(5, Math.max(0.5, Math.round(Number(trimmed) * 2) / 2))
}
