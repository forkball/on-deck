import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PHASE_LABELS, type GenerationPhase } from '../../data/generationProgress.ts'
import { GenerationProgress } from '../../assets/generation-progress.tsx'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface GeneratingPageProps {
  jobId: string
  phase: GenerationPhase
  phases: GenerationPhase[]
  error?: string
  statusHref: string
  displayName: string
}

// The wait while a run generates.
//
// Server-rendered with the real current stage, so it reads correctly before
// any JavaScript runs — and the <noscript> refresh means it still advances
// without any. The island on top only replaces full page reloads with a
// quieter poll.
export function GeneratingPage(handle: Handle<GeneratingPageProps>) {
  return () => {
    const { jobId, phase, phases, error, statusHref, displayName } = handle.props

    return (
      <Document
        title="Generating recommendations | On Deck"
        head={
          // Only when scripting is off: with the island running, this would
          // reload the page underneath it.
          <noscript>
            <meta httpEquiv="refresh" content="3" />
          </noscript>
        }
      >
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Putting your picks together</h1>

          {error ? (
            <p mix={css({ color: '#b91c1c' })}>{error}</p>
          ) : (
            <>
              <GenerationProgress
                statusHref={statusHref}
                initialLabel={PHASE_LABELS[phase]}
                initialPhase={phase}
                phases={phases}
                labels={PHASE_LABELS}
                key={jobId}
              />
              <p mix={css({ fontSize: '13px', color: '#888' })}>
                This takes a little while — two of these steps are the model thinking. You can leave this
                page open; it'll go to your picks on its own.
              </p>
            </>
          )}
        </main>
      </Document>
    )
  }
}
