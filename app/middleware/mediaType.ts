import { Session } from 'remix/session'
import type { Middleware, RequestContext } from 'remix/router'

import { DEFAULT_MEDIA_TYPE, parseEnabledMediaType, type ActiveMediaType } from '../utils/mediaTypes.ts'

// Remembers which media type (movie/tv) the user was last looking at, in
// the same signed session cookie already used for auth — read back by the
// "Media" nav link (routes.media, see actions/controller.tsx) and by the
// recommendations page when it isn't given an explicit ?mediaType=, so
// switching between Media and Recommendations stays on the same type
// instead of always bouncing back to movies.
// The session middleware is applied globally (see router.ts), so it's
// always present by the time any action/middleware here runs — the `!`s
// just work around this helper's loose context type not being able to
// prove that statically the way an inline controller action can.
export function rememberMediaType(mediaType: ActiveMediaType): Middleware {
  return async (context, next) => {
    const session = context.get(Session)!
    session.set('mediaType', mediaType)
    return next()
  }
}

export function getRememberedMediaType(context: RequestContext<any, any>): ActiveMediaType {
  const session = context.get(Session)!
  return parseEnabledMediaType(session.get('mediaType')) ?? DEFAULT_MEDIA_TYPE
}
