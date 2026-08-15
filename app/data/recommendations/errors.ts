// Throwing one of these puts its message in front of whoever is waiting on the
// run. Anything else throws to the log and shows them a generic line — see
// worker.ts, which is what enforces that.
export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}
