// How every catalog provider talks to its API: one retry policy, and one rule
// for when to stop asking a provider that has stopped answering.

const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

// Half the delay fixed, half random. A generation run puts several searches on
// the wire at once, and a fixed schedule has all of them sleep the same 400ms
// and retry in the same instant — the burst that drew the 503s, repeated twice
// more. The random half is what pulls the later waves apart; the fixed half
// keeps a floor under them.
export function backoffMs(attempt: number): number {
  const ceiling = RETRY_BASE_MS * 2 ** (attempt - 1)
  return ceiling / 2 + Math.random() * (ceiling / 2)
}

// `provider` names the service in the error, since the message is what reaches
// the log and one provider's outage should not read as another's.
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

// Stops a provider that is down from being asked once per pick.
//
// It is not a shield over a single wave: a run fans several searches out at
// once, so the first of them are already in flight before any has failed, and
// those still pay full retries. What it stops is everything after that — the
// rest of the fan-out, and the next run a minute later, each otherwise
// rediscovering the same outage at three requests and 1.2s of sleeping apiece.
export interface ProviderCircuit {
  isOpen(): boolean
  recordSuccess(): void
  recordFailure(): void
}

export function createProviderCircuit(threshold: number, cooldownMs: number): ProviderCircuit {
  let failures = 0
  let lastFailureAt = 0

  return {
    // Half-open once the cooldown is up: the next caller through decides it,
    // closing the circuit if it succeeds and restarting the cooldown if not.
    isOpen: () => failures >= threshold && Date.now() - lastFailureAt < cooldownMs,
    recordSuccess: () => {
      failures = 0
    },
    recordFailure: () => {
      failures++
      lastFailureAt = Date.now()
    },
  }
}
