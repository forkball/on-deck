import type { Handle } from 'remix/ui'
import { clientEntry, css, ref } from 'remix/ui'

import { GenerationFailure } from '../ui/shared/generation-failure.tsx'

// Polls for the stage a run is actually in. Every label comes from the server
// having entered that stage, so progress can't run backwards or be invented.
//
// Comments in this file ship with the bundle — keep vendor and catalog names out.
const POLL_MS = 1200

// A poll can fail for reasons unrelated to the run — a deploy, a dropped
// connection — so giving up on the first one would freeze the page on its last
// stage while the run finishes fine behind it.
const MAX_CONSECUTIVE_FAILURES = 8

const listStyle = css({
  listStyle: 'none',
  margin: '0 0 20px',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const stepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#888',
  fontSize: '14px',
})

const activeStepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#111',
  fontSize: '14px',
  fontWeight: 'bold',
})

const doneStepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#15803d',
  fontSize: '14px',
})

export type GenerationProgressProps = {
  statusHref: string
  // Where a run that came back with nothing sends someone: the form they set the
  // filters on. Passed in because a client entry can't reach routes.ts.
  formHref: string
  initialLabel: string
  initialPhase: string
  initialStatus: string
  initialQueuedAhead: number | null
  phases: string[]
  labels: Record<string, string>
}

export const GenerationProgress = clientEntry<GenerationProgressProps>(
  import.meta.url,
  function GenerationProgress(handle: Handle<GenerationProgressProps>) {
    let phase = handle.props.initialPhase
    let queueState = handle.props.initialStatus
    let ahead: number | null = handle.props.initialQueuedAhead
    let failed: string | null = null
    let lostContact = false

    // handle.update() returns a promise that rejects when there's no renderer to
    // schedule against, and called bare from the loop below that rejection has
    // nothing to catch it. A dropped update only costs a frame — the state it
    // was announcing is read out of this closure by the next render.
    function render(): void {
      void handle.update().catch(() => {})
    }

    async function poll(signal: AbortSignal) {
      let consecutiveFailures = 0

      while (!signal.aborted) {
        const wait = POLL_MS * Math.min(1 + consecutiveFailures, 5)
        await new Promise((resolve) => setTimeout(resolve, wait))
        if (signal.aborted) return

        try {
          const response = await fetch(handle.props.statusHref, {
            headers: { Accept: 'application/json' },
            signal,
          })

          if (response.status === 404) {
            failed = 'This run is no longer available. It may have finished a while ago.'
            render()
            return
          }
          if (!response.ok) {
            consecutiveFailures++
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return void giveUp()
            continue
          }

          const status = (await response.json()) as {
            status: string
            phase: string
            queuedAhead: number | null
            done: boolean
            href: string | null
            error: string | null
          }
          consecutiveFailures = 0

          if (status.error) {
            failed = status.error
            render()
            return
          }

          if (status.done && status.href) {
            window.location.href = status.href
            return
          }

          if (status.status !== queueState || status.phase !== phase || status.queuedAhead !== ahead) {
            queueState = status.status
            phase = status.phase
            ahead = status.queuedAhead
            render()
          }
        } catch {
          consecutiveFailures++
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return void giveUp()
        }
      }
    }

    function giveUp() {
      lostContact = true
      render()
    }

    return () => {
      const { phases, labels } = handle.props

      function panel() {
        if (failed) return <GenerationFailure message={failed} backHref={handle.props.formHref} />

        if (lostContact) {
          return (
            <p mix={css({ color: '#b91c1c' })}>
              Lost contact with the server. Your picks are probably still being put together —{' '}
              <a href="">reload</a> to check.
            </p>
          )
        }

        if (queueState === 'queued') {
          return (
            <p mix={css({ color: '#555' })}>
              Waiting to start
              {ahead != null && ahead > 0 ? ` — ${ahead} ${ahead === 1 ? 'run' : 'runs'} ahead of yours` : ''}
              …
            </p>
          )
        }

        const current = phases.indexOf(phase)

        return (
          <ul mix={listStyle}>
            {phases.map((step, index) => {
              const done = index < current
              const active = index === current

              return (
                <li key={step} mix={done ? doneStepStyle : active ? activeStepStyle : stepStyle}>
                  <span aria-hidden="true">{done ? '✓' : active ? '◐' : '○'}</span>
                  <span>{labels[step]}</span>
                </li>
              )
            })}
          </ul>
        )
      }

      // Polling starts in a ref, which only fires in a browser: the setup above
      // also runs on the server to build the first paint, and a loop started
      // there fetches a relative URL that can't resolve.
      //
      // It has to be this wrapper rather than the panel itself. A ref aborts on
      // remove, and the panel swaps between a paragraph and a list as the run
      // moves, so every swap would abort the loop and start another. This element
      // survives all of it — display: contents, so it changes no layout.
      return (
        <div mix={[css({ display: 'contents' }), ref((_node, signal) => void poll(signal))]}>{panel()}</div>
      )
    }
  },
)
