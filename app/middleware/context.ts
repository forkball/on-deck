import type { ContextWithParams, MiddlewareContext } from 'remix/router'
import type { formData } from 'remix/middleware/form-data'
import type { session } from 'remix/middleware/session'

import type { loadDatabase } from '../data/db.ts'
import type { User } from '../data/schema.ts'
import type { loadAuth, requireAuth } from './auth.ts'
import type { render } from './render.tsx'

// What every action receives, derived from the middleware stack in router.ts —
// the order here has to match the order they are installed there.
//
// Lives in its own module so a handler written outside createController can name
// its context. Importing it from router.ts would be a cycle, since router.ts
// imports the controllers.
export type AppContext = MiddlewareContext<
  [
    ReturnType<typeof render>,
    ReturnType<typeof formData>,
    ReturnType<typeof session>,
    ReturnType<typeof loadDatabase>,
    ReturnType<typeof loadAuth>,
  ]
>

// The context inside a media-type controller: the router's stack above, plus
// requireAuth. Reconstructed rather than inferred because createController
// resolves action types from the concrete route map, and routes.movies.show
// and routes.tv.show are different generic instantiations — so a factory over
// the route map can't typecheck.
//
// requireAuth is part of this: it narrows the Auth entry, which is why
// `context.get(Auth)` inside these actions is already known to have identified
// someone.
export type MediaControllerContext = MiddlewareContext<
  [
    ReturnType<typeof render>,
    ReturnType<typeof formData>,
    ReturnType<typeof session>,
    ReturnType<typeof loadDatabase>,
    ReturnType<typeof loadAuth>,
    ReturnType<typeof requireAuth<User>>,
  ]
>

// The same, for the routes carrying a media item id.
export type MediaItemControllerContext = ContextWithParams<MediaControllerContext, { mediaItemId: string }>

// The router's stack plus requireAuth, for controllers that gate on sign-in but
// add no middleware of their own.
export type AuthedControllerContext = MiddlewareContext<
  [
    ReturnType<typeof render>,
    ReturnType<typeof formData>,
    ReturnType<typeof session>,
    ReturnType<typeof loadDatabase>,
    ReturnType<typeof loadAuth>,
    ReturnType<typeof requireAuth<User>>,
  ]
>

// A staged import, and the routes that address one of its rows.
export type ImportBatchContext = ContextWithParams<AuthedControllerContext, { batchId: string }>
export type ImportRowContext = ContextWithParams<AuthedControllerContext, { batchId: string; rowId: string }>
