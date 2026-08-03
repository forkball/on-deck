import { createController } from 'remix/router'

import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { rememberMediaType } from '../../middleware/mediaType.ts'
import { routes } from '../../routes.ts'
import { createMediaActions } from '../mediaActions.tsx'

// All six handlers come from createMediaActions; only the route map and the
// media type are movie-specific.
export default createController(routes.movies, {
  middleware: [requireAuth<User>(), rememberMediaType('movie')],
  actions: createMediaActions('movie'),
})
