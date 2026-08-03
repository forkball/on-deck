import type { Middleware } from 'remix/router'

import { isMediaTypeEnabled, type ActiveMediaType } from '../mediaTypes.ts'

// Hiding the tab isn't enough: the routes stay mapped, so /games/search would
// still answer and still write catalog rows for an unreachable type. 404 rather
// than 403, since a gated type shouldn't advertise that it exists.
export function requireEnabledMediaType(mediaType: ActiveMediaType): Middleware {
  return async (context, next) => {
    if (!isMediaTypeEnabled(mediaType)) return new Response('Not Found', { status: 404 })
    return next()
  }
}
