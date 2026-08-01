import { createRouter, type MiddlewareContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'
import { methodOverride } from 'remix/middleware/method-override'
import { session } from 'remix/middleware/session'

import controller from './actions/controller.tsx'
import authController from './actions/auth/controller.tsx'
import authLoginController from './actions/auth/login/controller.tsx'
import authSignupController from './actions/auth/signup/controller.tsx'
import booksController from './actions/books/controller.tsx'
import interactionsController from './actions/interactions/controller.tsx'
import moviesController from './actions/movies/controller.tsx'
import notificationsController from './actions/notifications/controller.tsx'
import profileController from './actions/profile/controller.tsx'
import profileImportController from './actions/profile/import/controller.tsx'
import profileImportBooksController from './actions/profile/import-books/controller.tsx'
import recommendationsController from './actions/recommendations/controller.tsx'
import tvController from './actions/tv/controller.tsx'
import usersController from './actions/users/controller.tsx'
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
    // Default max file size (2 MiB) is too small for some ratings.csv exports.
    formData({ maxFileSize: 25 * 1024 * 1024 }),
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
router.map(routes.books, booksController)
router.map(routes.tv, tvController)
router.map(routes.interactions, interactionsController)
router.map(routes.notifications, notificationsController)
router.map(routes.profile, profileController)
router.map(routes.profile.import, profileImportController)
router.map(routes.profile.importBooks, profileImportBooksController)
router.map(routes.recommendations, recommendationsController)
router.map(routes.users, usersController)
