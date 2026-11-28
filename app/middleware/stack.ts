import { createMiddleware } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'
import { methodOverride } from 'remix/middleware/method-override'
import { session } from 'remix/middleware/session'

import { loadDatabase } from '../data/db.ts'
import { accessLog } from './accessLog.ts'
import { loadAuth } from './auth.ts'
import { inPlace } from './inPlace.ts'
import { render } from './render.tsx'
import { sessionCookie, sessionStorage } from './session.ts'

// The router's middleware, in the order it runs. Kept out of router.ts so
// context.ts can derive AppContext from it: router.ts imports the controllers,
// and the controllers import context.ts, so typing the context off router.ts
// would be a cycle.
export const appMiddleware = createMiddleware(
  staticFiles('./public', { index: false }),
  accessLog(),
  inPlace(),
  render(),
  // Default max file size (2 MiB) is too small for some ratings.csv exports.
  formData({ maxFileSize: 25 * 1024 * 1024 }),
  methodOverride(),
  session(sessionCookie, sessionStorage),
  loadDatabase(),
  loadAuth(),
)
