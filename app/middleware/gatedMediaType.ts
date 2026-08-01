import type { Middleware } from 'remix/router'

import { isMediaTypeEnabled, type ActiveMediaType } from '../utils/mediaTypes.ts'

// Refuses every route in a media type's group while that type is gated.
//
// Hiding the tab isn't enough on its own: the routes stay mapped, so
// /games/search would still answer, still spend a catalog request, and still
// write catalog rows for a type that isn't meant to be reachable. Anyone
// with an old link or a guess at the URL gets in.
//
// 404 rather than 403 — a gated type shouldn't advertise that it exists.
export function requireEnabledMediaType(mediaType: ActiveMediaType): Middleware {
  return async (context, next) => {
    if (!isMediaTypeEnabled(mediaType)) return new Response('Not Found', { status: 404 })
    return next()
  }
}
