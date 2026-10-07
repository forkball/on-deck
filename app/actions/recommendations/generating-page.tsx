import type { Handle } from 'remix/ui'

import { PHASE_LABELS, type GenerationPhase } from '../../data/recommendations/jobs.ts'
import { GenerationProgress } from '../../browser/generation-progress.tsx'
import { Page } from '../../ui/components/page.tsx'
import { GenerationFailure } from '../../ui/shared/generation-failure.tsx'

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
      <Page
        title="Generating recommendations"
        heading="Putting your picks together"
        displayName={displayName}
        head={
          // With the client entry running, this would reload the page under it.
          <noscript>
            <meta httpEquiv="refresh" content="3" />
          </noscript>
        }
      >
        {error ? (
          <GenerationFailure message={error} backHref={formHref} />
        ) : (
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
        )}
      </Page>
    )
  }
}
