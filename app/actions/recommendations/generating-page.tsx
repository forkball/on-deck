import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PHASE_LABELS, type GenerationPhase } from '../../data/recommendations/jobs.ts'
import { GenerationProgress } from '../../browser/generation-progress.tsx'
import { Document } from '../../ui/components/document.tsx'
import { GenerationFailure } from '../../ui/shared/generation-failure.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface GeneratingPageProps {
  jobId: string
  phase: GenerationPhase
  phases: GenerationPhase[]
  status: string
  queuedAhead: number | null
  error?: string
  statusHref: string
  formHref: string
  displayName: string
}

// Server-rendered with the real current stage, and the <noscript> refresh keeps
// it advancing without JavaScript. The client entry only replaces full reloads
// with a quieter poll.
export function GeneratingPage(handle: Handle<GeneratingPageProps>) {
  return () => {
    const { jobId, phase, phases, status, queuedAhead, error, statusHref, formHref, displayName } =
      handle.props

    return (
      <Document
        title="Generating recommendations | On Deck"
        head={
          // With the client entry running, this would reload the page under it.
          <noscript>
            <meta httpEquiv="refresh" content="3" />
          </noscript>
        }
      >
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Putting your picks together</h1>

          {error ? (
            <GenerationFailure message={error} backHref={formHref} />
          ) : (
            <>
              <GenerationProgress
                statusHref={statusHref}
                formHref={formHref}
                initialLabel={PHASE_LABELS[phase]}
                initialPhase={phase}
                initialStatus={status}
                initialQueuedAhead={queuedAhead}
                phases={phases}
                labels={PHASE_LABELS}
                key={jobId}
              />
              <p mix={css({ fontSize: '13px', color: '#888' })}>
                This takes a little while — two of these steps are the model thinking. You can leave this page
                open; it'll go to your picks on its own.
              </p>
            </>
          )}
        </main>
      </Document>
    )
  }
}
