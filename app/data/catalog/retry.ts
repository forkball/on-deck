const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

// Exponential, and half of each delay random. A generation run puts several
// searches on the wire at once; a fixed schedule sleeps all of them for the
// same 400ms and retries them in the same instant, which is the burst that drew
// the failures being retried. The fixed half keeps a floor under the delay.
export function backoffMs(attempt: number): number {
  const ceiling = RETRY_BASE_MS * 2 ** (attempt - 1)
  return ceiling / 2 + Math.random() * (ceiling / 2)
}

// GET-by-URL only, which is what Google Books and Open Library need. IGDB posts
// with headers and TMDB retries nothing, so neither goes through here yet.
export async function fetchWithRetry(url: URL, provider: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      // 5xx is worth another go; a 4xx means the request itself is wrong.
      if (response.ok || response.status < 500) return response
      lastError = new Error(`${provider} responded ${response.status}`)
    } catch (error) {
      lastError = error
    }

    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${provider} request failed`)
}
