import { createController } from 'remix/router'

import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { routes } from '../../routes.ts'
import { createMediaActions } from '../mediaActions.tsx'

// See movies/controller.tsx — all six handlers are shared; only the route map
// and the media type differ.
export default createController(routes.games, {
  middleware: [requireAuth<User>()],
  actions: createMediaActions('game'),
})
