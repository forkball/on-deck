// Stops a provider that is down from being asked once per pick.
//
// Not a shield over a single fan-out — several requests are in flight before
// any has failed, and those still pay full retries. It bounds what comes after.
export interface ProviderCircuit {
  isOpen(): boolean
  // Runs `operation`, recording whether it threw. Callers check isOpen()
  // themselves because what to do about an open circuit differs: a provider
  // with a fallback takes it, one without has to give up.
  run<T>(operation: () => Promise<T>): Promise<T>
}

export function createProviderCircuit(threshold: number, cooldownMs: number): ProviderCircuit {
  let failures = 0
  let lastFailureAt = 0

  return {
    // Half-open once the cooldown is up, so the next caller through decides it.
    isOpen: () => failures >= threshold && Date.now() - lastFailureAt < cooldownMs,

    async run(operation) {
      try {
        const result = await operation()
        failures = 0
        return result
      } catch (error) {
        failures++
        lastFailureAt = Date.now()
        throw error
      }
    },
  }
}
