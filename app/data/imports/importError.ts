// An import failure worded for the member who caused it: a file that isn't the
// export, a zip that doesn't read, a Letterboxd or Steam profile that is private.
// The import pages show this message as it stands — the same rule
// GenerationError holds for a recommendation run.
//
// Everything else that goes wrong on the way (a database error, a missing API
// key, a bug in a parser) is a plain Error, and its message is for the log, not
// the page: the controllers show their own generic wording for it instead. A
// class rather than a result type because the parsers fail from deep inside
// (`openZip` reading an entry three calls down), where threading a result back
// out would be every function in between saying the same thing twice.
//
// Imports nothing, so the database-free parsers can throw it without dragging
// anything in.
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

// The message for the page, or null when the error isn't one written for it —
// in which case the caller logs it and shows its own fallback.
export function memberFacingMessage(error: unknown): string | null {
  return error instanceof ImportError ? error.message : null
}
