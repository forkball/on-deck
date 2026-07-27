import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'

import { assetServer } from '../assets.ts'
import { displayLabel } from '../data/users.ts'
import { routes } from '../routes.ts'
import { HomePage } from '../ui/pages/home-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    home(context) {
      const auth = context.get(Auth)
      return context.render(
        <HomePage
          authed={auth.ok}
          displayName={auth.ok ? displayLabel(auth.identity) : undefined}
        />,
      )
    },
  },
})
