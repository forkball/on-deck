// A failure whose message is written for whoever is waiting on the run, rather
// than for whoever is debugging it.
//
// Throwing one of these says the message is for the person. Throwing anything
// else leaves them with the generic line and sends the detail to the log —
// which is the right place for a provider's response body, an environment
// variable name, or a model stop reason. See worker.ts.
export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}
