import type { Middleware } from 'remix/router'

import { logger, withLogContext } from '../log.ts'

const log = logger('http')

// One line per request, and the log context every line under it inherits.
//
// Without this the stream is silent for anything that isn't a search, a run or a
// failure — an app serving pages logs nothing at all, which reads exactly like a
// broken log pipeline and cost this project a week of believing it had one. It also
// means a 500 leaves a stack with no URL on it.
//
// Static files are skipped: they are most of the requests and none of the questions.
export function accessLog(): Middleware {
  return async (context, next) => {
    const { method, url } = context.request
    const path = new URL(url).pathname
    if (path.startsWith('/assets/') || path === '/favicon.ico') return next()

    const startedAt = Date.now()
    // Around the handler, so anything it logs — including a catalog client four
    // layers down — says which request it was for. The user is added by loadAuth
    // rather than here; this runs before the session is read.
    return withLogContext({}, async () => {
      try {
        const response = await next()
        log.info(`${method} ${path} ${response.status} ${Date.now() - startedAt}ms`)
        return response
      } catch (error) {
        // The router turns this into a 500 after us, so say which request it was
        // before that happens and rethrow untouched.
        log.error(`${method} ${path} failed after ${Date.now() - startedAt}ms`, error)
        throw error
      }
    })
  }
}
