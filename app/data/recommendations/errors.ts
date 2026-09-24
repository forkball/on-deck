// Throwing one of these puts its message in front of whoever is waiting on the
// run. Anything else throws to the log and shows them a generic line — see
// worker.ts, which is what enforces that.
export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}

// The catalog wouldn't answer — distinct from the other generation failures
// because the run is recoverable from here: the model has already said what it
// thinks, and that answer is worth showing even though nothing could confirm it.
// See generate.ts, which turns one of these into an unconfirmed run.
export class CatalogUnavailableError extends GenerationError {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogUnavailableError'
  }
}
