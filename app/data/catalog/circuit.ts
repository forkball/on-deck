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

export function createProviderCircuit(name: string, threshold: number, cooldownMs: number): ProviderCircuit {
  let failures = 0
  let lastFailureAt = 0
  // Whether the open line has been logged for the outage now in progress. An
  // open circuit is consulted once per call, and one line per suppressed call
  // would bury the thing it is reporting.
  let announced = false

  return {
    // Half-open once the cooldown is up, so the next caller through decides it.
    isOpen() {
      const open = failures >= threshold && Date.now() - lastFailureAt < cooldownMs
      if (announced && !open) {
        announced = false
        console.info(`[catalog] ${name} circuit half-open — the next call tries it for real`)
      }
      return open
    },

    async run(operation) {
      try {
        const result = await operation()
        // Worth saying out loud: while the circuit was open every call went to
        // the fallback silently, so recovery and "still suppressed" look the
        // same from the log — both are an absence of failures.
        if (failures > 0) console.info(`[catalog] ${name} recovered after ${failures} failure(s)`)
        failures = 0
        announced = false
        return result
      } catch (error) {
        failures++
        lastFailureAt = Date.now()
        if (failures >= threshold && !announced) {
          announced = true
          console.warn(
            `[catalog] ${name} circuit open after ${failures} consecutive failures — ` +
              `skipping it for ${Math.round(cooldownMs / 1000)}s`,
          )
        }
        throw error
      }
    },
  }
}
