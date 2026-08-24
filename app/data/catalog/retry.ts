const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

// A 5xx body is where a provider says which 5xx this is. Google Books answers
// an exhausted quota and a genuinely overloaded backend with the same 503, and
// only the body tells them apart — the status alone sends you looking for an
// outage that isn't there. Truncated because a failed attempt logs it.
const ERROR_BODY_MAX = 200

// Exponential, and half of each delay random. A generation run puts several
// searches on the wire at once; a fixed schedule sleeps all of them for the
// same 400ms and retries them in the same instant, which is the burst that drew
// the failures being retried. The fixed half keeps a floor under the delay.
export function backoffMs(attempt: number): number {
  const ceiling = RETRY_BASE_MS * 2 ** (attempt - 1)
  return ceiling / 2 + Math.random() * (ceiling / 2)
}

// Only ever called on a response that is about to be thrown away, so consuming
// the body here costs nothing.
async function describeResponse(response: Response): Promise<string> {
  const parts = [`responded ${response.status}`]

  // Present on a real rate limit and absent on an overload, which by itself
  // separates the two cases the body is being read to distinguish.
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) parts.push(`retry-after ${retryAfter}`)

  try {
    const body = (await response.text()).replace(/\s+/g, ' ').trim()
    if (body) parts.push(body.slice(0, ERROR_BODY_MAX))
  } catch {
    // A body that will not read must not take the status down with it — the
    // status is the part always worth reporting.
    parts.push('<body unreadable>')
  }

  return parts.join(' ')
}

// GET-by-URL only, which is what Google Books and Open Library need. IGDB posts
// with headers and TMDB retries nothing, so neither goes through here yet.
export async function fetchWithRetry(url: URL, provider: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const startedAt = Date.now()
    let detail: string

    try {
      const response = await fetch(url)
      // 5xx is worth another go; a 4xx means the request itself is wrong.
      if (response.ok || response.status < 500) return response
      detail = await describeResponse(response)
      lastError = new Error(`${provider} ${detail}`)
    } catch (error) {
      lastError = error
      detail = error instanceof Error ? error.message : String(error)
    }

    // Logged per attempt rather than once at the end, because a call that
    // succeeds on the third try returns an ordinary Response and reports
    // nothing — the two failures that paid for the latency would otherwise
    // leave no trace, which is exactly the case that looks like "the provider
    // is just slow".
    console.warn(
      `[catalog] ${provider} attempt ${attempt}/${FETCH_ATTEMPTS} failed after ${Date.now() - startedAt}ms: ${detail}`,
    )

    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${provider} request failed`)
}
