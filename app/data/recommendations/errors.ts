// A failure whose message is written to be read by whoever is waiting on the
// run, rather than by whoever is debugging it.
//
// The waiting page shows the message of whatever ended the run (worker.ts),
// and for a long time that meant every throw in the pipeline was user-facing
// copy whether or not it had been written as any. Most of it hadn't: a person
// waiting for film recommendations was shown a catalog provider's raw response
// body, the name of an environment variable, or a stop reason from a model
// API. The one place that did write copy on purpose had to say so in a comment,
// because nothing in the code distinguished it.
//
// So the distinction is this class, and the default is silence. Throwing one of
// these says the message is for the person; throwing anything else leaves them
// with the generic line and sends the detail to the log, which is where a stop
// reason was always more use anyway.
export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}
