import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { Nav } from './nav.tsx'

export function HomePage(handle: Handle<{ authed: boolean }>) {
  return () => {
    const { authed } = handle.props

    return (
      <Document title="On Deck">
        <Nav authed={authed} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '48px 24px' })}>
          <h1>On Deck</h1>
          <p>
            A media taste profile for you (and your group) — movies, TV, comics, books, and games
            — with a Claude-powered recommender that knows what you actually like.
          </p>
          {authed ? (
            <p>
              <a href={routes.movies.search.href()}>Search for a movie to log</a> or{' '}
              <a href={routes.profile.index.href()}>edit your taste profile</a>.
            </p>
          ) : (
            <p>
              <a href={routes.auth.signup.index.href()}>Sign up</a> or{' '}
              <a href={routes.auth.login.index.href()}>log in</a> to get started.
            </p>
          )}
        </main>
      </Document>
    )
  }
}
