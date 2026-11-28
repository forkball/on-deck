import { createRouter } from 'remix/router'

import controller from './actions/controller.tsx'
import adminController from './actions/admin/controller.tsx'
import authController from './actions/auth/controller.tsx'
import authForgotController from './actions/auth/forgot/controller.tsx'
import authLoginController from './actions/auth/login/controller.tsx'
import authResetController from './actions/auth/reset/controller.tsx'
import authSignupController from './actions/auth/signup/controller.tsx'
import booksController from './actions/books/controller.tsx'
import gamesController from './actions/games/controller.tsx'
import interactionsController from './actions/interactions/controller.tsx'
import moviesController from './actions/movies/controller.tsx'
import notificationsController from './actions/notifications/controller.tsx'
import profileController from './actions/profile/controller.tsx'
import profileEditController from './actions/profile/edit/controller.tsx'
import profilePasswordController from './actions/profile/password/controller.tsx'
import profileImportMoviesController from './actions/profile/import-movies/controller.tsx'
import profileImportsController from './actions/profile/imports/controller.tsx'
import profileImportBooksController from './actions/profile/import-books/controller.tsx'
import profileImportGamesController from './actions/profile/import-games/controller.tsx'
import profileSteamController from './actions/profile/steam/controller.tsx'
import profileLetterboxdController from './actions/profile/letterboxd/controller.tsx'
import recommendationsController from './actions/recommendations/controller.tsx'
import tvController from './actions/tv/controller.tsx'
import usersController from './actions/users/controller.tsx'
import type { AppContext } from './middleware/context.ts'
import { appMiddleware } from './middleware/stack.ts'
import { routes } from './routes.ts'

declare module 'remix/router' {
  interface RouterTypes {
    context: AppContext
  }
}

export const router = createRouter<AppContext>({
  middleware: appMiddleware,
})

router.map(routes, controller)
router.map(routes.admin, adminController)
router.map(routes.auth, authController)
router.map(routes.auth.login, authLoginController)
router.map(routes.auth.forgot, authForgotController)
router.map(routes.auth.reset, authResetController)
router.map(routes.auth.signup, authSignupController)
router.map(routes.movies, moviesController)
router.map(routes.books, booksController)
router.map(routes.games, gamesController)
router.map(routes.tv, tvController)
router.map(routes.interactions, interactionsController)
router.map(routes.notifications, notificationsController)
router.map(routes.profile, profileController)
router.map(routes.profile.edit, profileEditController)
router.map(routes.profile.password, profilePasswordController)
router.map(routes.profile.importMovies, profileImportMoviesController)
router.map(routes.profile.imports, profileImportsController)
router.map(routes.profile.importBooks, profileImportBooksController)
router.map(routes.profile.importGames, profileImportGamesController)
router.map(routes.profile.steam, profileSteamController)
router.map(routes.profile.letterboxd, profileLetterboxdController)
router.map(routes.recommendations, recommendationsController)
router.map(routes.users, usersController)
