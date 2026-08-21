import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { assetServer } from '../assets.ts'
import { getLuckyState } from '../data/recommendations/lucky.ts'
import { displayLabel } from '../data/users.ts'
import { getRememberedMediaType } from '../middleware/mediaType.ts'
import { routes } from '../routes.ts'
import { HomePage } from './home-page.tsx'
import { MEDIA_TYPE_UI } from '../mediaTypes.ts'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    async home(context) {
      const auth = context.get(Auth)
      return context.render(
        <HomePage
          authed={auth.ok}
          displayName={auth.ok ? displayLabel(auth.identity) : undefined}
          // One query, and only for someone signed in — see lucky.ts. This page
          // is otherwise free, and it stays that way for a visitor.
          lucky={auth.ok ? await getLuckyState(context.get(Database), auth.identity) : undefined}
        />,
      )
    },
    media(context) {
      return redirect(MEDIA_TYPE_UI[getRememberedMediaType(context)].hrefs.search(), 303)
    },
  },
})
