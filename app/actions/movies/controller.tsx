import { createController } from 'remix/router'

import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { rememberMediaType } from '../../middleware/mediaType.ts'
import { routes } from '../../routes.ts'
import { createMediaActions } from '../mediaActions.tsx'

// All six handlers are shared — see createMediaActions. Only the route map,
// the remembered type, and the media type itself are movie-specific.
export default createController(routes.movies, {
  middleware: [requireAuth<User>(), rememberMediaType('movie')],
  actions: createMediaActions('movie'),
})
