import { createRouter, type MiddlewareContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'
import { methodOverride } from 'remix/middleware/method-override'
import { session } from 'remix/middleware/session'

import controller from './actions/controller.tsx'
import authController from './actions/auth/controller.tsx'
import authLoginController from './actions/auth/login/controller.tsx'
import authSignupController from './actions/auth/signup/controller.tsx'
import moviesController from './actions/movies/controller.tsx'
import profileController from './actions/profile/controller.tsx'
import { loadDatabase } from './data/db.ts'
import { loadAuth } from './middleware/auth.ts'
import { render } from './middleware/render.tsx'
import { sessionCookie, sessionStorage } from './middleware/session.ts'
import { routes } from './routes.ts'

type AppContext = MiddlewareContext<
  [
    ReturnType<typeof render>,
    ReturnType<typeof formData>,
    ReturnType<typeof session>,
    ReturnType<typeof loadDatabase>,
    ReturnType<typeof loadAuth>,
  ]
>

declare module 'remix/router' {
  interface RouterTypes {
    context: AppContext
  }
}

export const router = createRouter<AppContext>({
  middleware: [
    staticFiles('./public', { index: false }),
    render(),
    formData(),
    methodOverride(),
    session(sessionCookie, sessionStorage),
    loadDatabase(),
    loadAuth(),
  ],
})

router.map(routes, controller)
router.map(routes.auth, authController)
router.map(routes.auth.login, authLoginController)
router.map(routes.auth.signup, authSignupController)
router.map(routes.movies, moviesController)
router.map(routes.profile, profileController)
