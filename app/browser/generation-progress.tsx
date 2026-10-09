import type { Handle } from 'remix/ui'
import { clientEntry, css, ref } from 'remix/ui'
import { Link } from '../ui/shared/form-controls.tsx'

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
  color: 'var(--muted)',
  fontSize: '14px',
})

const activeStepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--ink)',
  fontSize: '14px',
  fontWeight: 'bold',
})

const failedStepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--danger)',
  fontSize: '14px',
  fontWeight: 'bold',
})

const doneStepStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--success)',
  fontSize: '14px',
})

export type GenerationProgressProps = {
  statusHref: string
  // Where a run that came back with nothing sends someone: the form they set the
  // filters on. Passed in because a client entry can't reach routes.ts.
  formHref: string
  // Offered beside it, for someone done with recommendations for now.
  homeHref: string
  initialLabel: string
  initialPhase: string
  initialStatus: string
  initialQueuedAhead: number | null
  // Queued again to wait out a catalog that wasn't answering. Its steps stay on
  // screen, since it has been through them, rather than reading as not started.
  initialRetrying: boolean
  phases: string[]
  labels: Record<string, string>
  // Why the run stopped, when it had already stopped before the page loaded. Set,
  // the page paints the failure over the steps and never starts polling.
  initialError?: string | null
}

export const GenerationProgress = clientEntry<GenerationProgressProps>(
  import.meta.url,
  function GenerationProgress(handle: Handle<GenerationProgressProps>) {
    let phase = handle.props.initialPhase
    let queueState = handle.props.initialStatus
    let ahead: number | null = handle.props.initialQueuedAhead
    let retrying = handle.props.initialRetrying
    // Why this page stopped following the run, or null while it still is. Only a
    // run that `failed` gets its step crossed out: a run that went missing, or that
    // the page lost contact with, may well still be going, so its steps stay as last
    // seen. `reload` is the way on for the lost-contact case.
    let stopped: { message: string; failed: boolean; reload: boolean } | null = handle.props.initialError
      ? { message: handle.props.initialError, failed: true, reload: false }
      : null

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
            stopped = {
              message: 'This run is no longer available. It may have finished a while ago.',
              failed: false,
              reload: false,
            }
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
            retrying?: boolean
            done: boolean
            href: string | null
            error: string | null
          }
          consecutiveFailures = 0

          if (status.error) {
            // The stage it stopped on, so the cross lands on the right step.
            phase = status.phase
            stopped = { message: status.error, failed: true, reload: false }
            render()
            return
          }

          if (status.done && status.href) {
            window.location.href = status.href
            return
          }

          const nowRetrying = status.retrying === true
          if (
            status.status !== queueState ||
            status.phase !== phase ||
            status.queuedAhead !== ahead ||
            nowRetrying !== retrying
          ) {
            retrying = nowRetrying
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
      stopped = {
        message: 'Lost contact with the server. Your picks are probably still being put together.',
        failed: false,
        reload: true,
      }
      render()
    }

    return () => {
      const { phases, labels } = handle.props

      // What stopped the run, or stopped this page following it. Above the steps,
      // which stay on screen so it is clear how far the run got. The message is
      // written where the failure happened and already says what to do about it.
      function notice() {
        if (stopped) return <p mix={css({ color: 'var(--danger)' })}>{stopped.message}</p>
        // Not an error, so not in red: the run is fine and will carry on by itself.
        if (retrying) {
          return (
            <p mix={css({ color: 'var(--soft)' })}>The catalog isn't answering — trying again in a minute.</p>
          )
        }
        return null
      }

      // The way on, under the steps: back to the form for a run that is over, a
      // reload for one this page has only lost track of.
      function nextStep() {
        if (!stopped) return null
        return (
          <p mix={css({ display: 'flex', flexWrap: 'wrap', gap: '16px' })}>
            {stopped.reload ? (
              <Link href="">Reload to check</Link>
            ) : (
              <Link href={handle.props.formHref}>Back to recommendations</Link>
            )}
            <Link href={handle.props.homeHref}>Home</Link>
          </p>
        )
      }

      function panel() {
        if (queueState === 'queued' && !stopped?.failed && !retrying) {
          return (
            <p mix={css({ color: 'var(--soft)' })}>
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
              const stoppedHere = active && stopped?.failed === true

              return (
                <li
                  key={step}
                  mix={
                    stoppedHere
                      ? failedStepStyle
                      : done
                        ? doneStepStyle
                        : active
                          ? activeStepStyle
                          : stepStyle
                  }
                >
                  <span aria-hidden="true">{stoppedHere ? '✗' : done ? '✓' : active ? '◐' : '○'}</span>
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
        <div
          mix={[
            css({ display: 'contents' }),
            // A run that had already failed when the page loaded has nothing to poll for.
            ref((_node, signal) => {
              if (!stopped) void poll(signal)
            }),
          ]}
        >
          {notice()}
          {panel()}
          {nextStep()}
        </div>
      )
    }
  },
)
