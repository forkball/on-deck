import { AsyncLocalStorage } from 'node:async_hooks'

// What the app writes to stdout, and who it was for.
//
// The lines were readable already. What they could not say is which run they belonged
// to: a generation run makes up to 18 catalog searches across two providers, and when
// Google Books answered 503 eleven times in a row the only way to tie that to the run
// it emptied was to compare timestamps by hand against the job table. Two runs at once
// and even that stops working.
//
// So a line carries its context: the job, and whatever else the caller put in scope.
// Async-local rather than threaded through every signature, because the calls that
// most need it are four layers down in the catalog client, which knows nothing about
// runs and shouldn't — the same reason timings.ts keeps its recorder this way.
export interface LogContext {
  job?: string
  batch?: number
  user?: number
}

const storage = new AsyncLocalStorage<LogContext>()

// Everything logged inside `work` carries these fields. Nested calls merge rather
// than replace, so a worker can set the job and an inner stage can add to it.
export function withLogContext<T>(fields: LogContext, work: () => T): T {
  return storage.run({ ...storage.getStore(), ...fields }, work)
}

// Rendered as trailing key=value pairs rather than JSON: these lines are read in a
// browser on the Fly dashboard far more often than they are parsed.
function suffix(): string {
  const context = storage.getStore()
  if (!context) return ''

  const pairs = Object.entries(context)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${value}`)

  return pairs.length > 0 ? ` (${pairs.join(' ')})` : ''
}

export interface Logger {
  info: (message: string, error?: unknown) => void
  warn: (message: string, error?: unknown) => void
  error: (message: string, error?: unknown) => void
}

// `[scope] message (job=…)`, plus the error on the same call so a caller never has to
// choose between saying what happened and passing the cause along.
export function logger(scope: string): Logger {
  const write =
    (level: 'info' | 'warn' | 'error') =>
    (message: string, error?: unknown): void => {
      const line = `[${scope}] ${message}${suffix()}`
      if (error === undefined) console[level](line)
      else console[level](line, error)
    }

  return { info: write('info'), warn: write('warn'), error: write('error') }
}
