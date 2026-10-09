import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../../../routes.ts'
import { LetterboxdImportForm } from '../../../browser/letterboxd-import-form.tsx'
import { Page } from '../../../ui/components/page.tsx'
import { Toast } from '../../../ui/components/toast.tsx'

export interface LetterboxdImportPageProps {
  displayName: string
  error?: string
  // Set when an earlier upload is still waiting to be matched or reviewed.
  pendingHref?: string
  // Whether the feed sync is available to this member. The connection itself is
  // managed in settings; all this decides is whether the page explains how the
  // upload and the feed divide the work, which is meaningless when there is no
  // feed to divide it with.
  syncAvailable: boolean
}

// Only true when the feed is switched on, and it is what explains why an upload
// is still worth doing once it is: the feed can't reach back past ~50 films.
const BACKFILL_LEAD =
  'The feed only reaches your fifty most recent films, so your back catalogue comes as a file. '

export function LetterboxdImportPage(handle: Handle<LetterboxdImportPageProps>) {
  return () => {
    const { displayName, error, pendingHref, syncAvailable } = handle.props

    return (
      <Page heading="Import from Letterboxd" displayName={displayName}>
        {pendingHref && (
          <div
            mix={css({
              border: '1px solid var(--rule)',
              borderLeft: '4px solid var(--accent)',
              borderRadius: '8px',
              background: 'var(--paper-tint)',
              padding: '12px 14px',
              marginBottom: '18px',
              fontSize: '14px',
            })}
          >
            You have an import waiting. <a href={pendingHref}>Pick it back up</a> — uploading again starts
            over.
          </div>
        )}

        <p mix={css({ color: 'var(--soft)' })}>
          {syncAvailable && BACKFILL_LEAD}
          Export your data from Letterboxd (Settings → Data → Export) and upload the <code>.zip</code>{' '}
          unopened — ratings and reviews both come across in one import.
        </p>

        <p mix={css({ fontSize: '13px', color: 'var(--muted)' })}>
          Letterboxd's app doesn't always deliver the export. If it doesn't arrive, export from letterboxd.com
          in a browser instead.
        </p>

        <LetterboxdImportForm
          uploadHref={routes.profile.importMovies.upload.href()}
          accept=".zip"
          error={error}
        />

        <p mix={css({ fontSize: '13px', color: 'var(--accent)' })}>
          Nothing is saved until you've seen what we matched.
        </p>

        {syncAvailable && (
          <p mix={css({ fontSize: '13px', color: 'var(--muted)' })}>
            New films are handled separately:{' '}
            <a href={routes.profile.edit.index.href()}>connect your Letterboxd account in settings</a> and
            they arrive on their own.
          </p>
        )}
      </Page>
    )
  }
}
