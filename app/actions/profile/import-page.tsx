import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { ActiveMediaType } from '../../mediaTypes.ts'
import { routes } from '../../routes.ts'
import { MediaTypeTag } from '../../ui/components/media-type-tag.tsx'
import { Page } from '../../ui/components/page.tsx'
import { ButtonLink, Link } from '../../ui/shared/form-controls.tsx'
import { PROFILE_TABS } from './edit/page.tsx'
import { WaitingImports, type WaitingImport } from './waiting-imports.tsx'

// Whether the source behind a medium is already wired up. Two of the three
// importers sit behind a connection, and which door to offer depends on it.
export interface ImportSources {
  // False when the feed is gated off this account, in which case there is no
  // connecting to offer and the upload is the only way in.
  letterboxdAvailable: boolean
  letterboxdConnected: boolean
  steamConnected: boolean
}

export interface ImportHubProps {
  displayName: string
  sources: ImportSources
  waitingImports: WaitingImport[]
}

const CONNECTIONS_HREF = `${routes.profile.edit.index.href()}?tab=${PROFILE_TABS.connections}`

const CARD = css({
  border: '1px solid var(--rule)',
  borderRadius: '8px',
  padding: '16px 18px',
  marginBottom: '16px',
})

const NOTE = css({ margin: '8px 0 0', fontSize: '13px', color: 'var(--soft)' })

function SourceCard(
  handle: Handle<{
    type: ActiveMediaType
    name: string
    children?: RemixNode
    actions: RemixNode
  }>,
) {
  return () => {
    const { type, name, children, actions } = handle.props

    return (
      <section mix={CARD}>
        <MediaTypeTag type={type} />
        <h2 mix={css({ margin: '4px 0 0', fontSize: '17px' })}>{name}</h2>
        {children}
        <div
          mix={css({
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '16px',
            marginTop: '12px',
          })}
        >
          {actions}
        </div>
      </section>
    )
  }
}

// Every way in, in one place. The importers each understand one medium, but
// someone arriving with a pile of history wants to see all of them at once
// rather than hunt through the profile's tabs for the right link.
//
// Uploading backfills a history; connecting is what keeps up with one
// afterwards. Both are offered where both exist, with the connection itself
// still managed in settings.
export function ImportPage(handle: Handle<ImportHubProps>) {
  return () => {
    const { displayName, sources, waitingImports } = handle.props
    const offerLetterboxdFeed = sources.letterboxdAvailable && !sources.letterboxdConnected

    return (
      <Page
        heading="Import"
        displayName={displayName}
        back={{ href: routes.profile.index.href(), label: '← Back to profile' }}
      >
        <p mix={css({ marginTop: 0, color: 'var(--soft)' })}>
          Bring across what you've already logged somewhere else. Nothing is saved until you've seen what we
          matched.
        </p>

        <WaitingImports imports={waitingImports} />

        <SourceCard
          type="movie"
          name="Letterboxd"
          actions={
            <>
              <ButtonLink href={routes.profile.importMovies.index.href()}>Upload your export</ButtonLink>
              {offerLetterboxdFeed && (
                <Link href={CONNECTIONS_HREF} tapArea>
                  Connect your diary
                </Link>
              )}
            </>
          }
        >
          <p mix={NOTE}>
            Your films, ratings and reviews, from the <code>.zip</code> Letterboxd exports.
            {sources.letterboxdConnected
              ? ' Your diary is connected, so new entries follow on their own.'
              : offerLetterboxdFeed
                ? ' Connect your diary as well and what you log from then on follows on its own.'
                : ''}
          </p>
        </SourceCard>

        <SourceCard
          type="book"
          name="Goodreads"
          actions={
            <ButtonLink href={routes.profile.importBooks.index.href()}>Upload your library</ButtonLink>
          }
        >
          <p mix={NOTE}>Your read, currently-reading and want-to-read shelves, with your reviews.</p>
        </SourceCard>

        <SourceCard
          type="game"
          name="Steam"
          actions={
            sources.steamConnected ? (
              <ButtonLink href={routes.profile.importGames.index.href()}>Import your library</ButtonLink>
            ) : (
              <Link href={CONNECTIONS_HREF} tapArea>
                Connect Steam
              </Link>
            )
          }
        >
          <p mix={NOTE}>
            The games you own and how long you've played them.
            {sources.steamConnected ? '' : ' Sign in through Steam in settings first.'}
          </p>
        </SourceCard>
      </Page>
    )
  }
}
