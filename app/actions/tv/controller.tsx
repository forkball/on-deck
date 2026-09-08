import { createController } from 'remix/router'

import type { User } from '../../data/schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { routes } from '../../routes.ts'
import { createMediaActions } from '../mediaActions.tsx'

// See movies/controller.tsx — both are thin bindings over createMediaActions.
export default createController(routes.tv, {
  middleware: [requireAuth<User>()],
  actions: createMediaActions('tv'),
})
