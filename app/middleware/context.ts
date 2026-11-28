import type { ContextWithParams, MiddlewareContext } from 'remix/router'

import type { User } from '../data/schema.ts'
import type { requireAuth } from './auth.ts'
import type { appMiddleware } from './stack.ts'

// What every action receives, derived from the router's middleware stack in
// stack.ts — so a middleware added there shows up here without restating it.
//
// Lives in its own module so a handler written outside createController can name
// its context. Importing it from router.ts would be a cycle, since router.ts
// imports the controllers.
export type AppContext = MiddlewareContext<typeof appMiddleware>

// The router's stack plus requireAuth, for controllers that gate on sign-in but
// add no middleware of their own — the media-type controllers and the file
// imports among them. Reconstructed rather than inferred because createController
// resolves action types from the concrete route map, and routes.movies.show
// and routes.tv.show are different generic instantiations — so a factory over
// the route map can't typecheck.
//
// requireAuth narrows the Auth entry, which is why `context.get(Auth)` inside
// these actions is already known to have identified someone.
export type AuthedControllerContext = MiddlewareContext<
  [...typeof appMiddleware, ReturnType<typeof requireAuth<User>>]
>

// The same, for the media-type routes carrying a media item id.
export type MediaItemControllerContext = ContextWithParams<AuthedControllerContext, { mediaItemId: string }>

// A staged import, and the routes that address one of its rows.
export type ImportBatchContext = ContextWithParams<AuthedControllerContext, { batchId: string }>
export type ImportRowContext = ContextWithParams<AuthedControllerContext, { batchId: string; rowId: string }>
