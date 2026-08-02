import type { Handle } from 'remix/ui'
import { clientEntry, css, on } from 'remix/ui'

// Polls the server for which stage a run is actually in, and replaces the
// caption as it moves.
//
// The captions are not on a timer. An earlier version cycled invented
// messages every 1.8 seconds and looped, so it said "Almost there" and then
// went back to the beginning — progress that ran backwards. Every label here
// comes from the server having entered that stage.
//
// Comments here ship to the browser with the bundle, so this names neither
// the model vendor nor the catalog.
const POLL_MS = 1200

// A poll can fail for reasons that have nothing to do with the run: a deploy
// swapping machines, a dropped connection, a momentary 500. This used to
// return out of the loop on the first one, which stopped polling for good and
// left the page frozen on its last stage while the run finished fine behind
// it. Failures are now tolerated until it's clear something is actually wrong.
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

// A type alias, not an interface: island props must satisfy the framework's
// SerializableProps index signature, which an interface doesn't provide.
export type GenerationProgressProps = {
  statusHref: string
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

    async function poll() {
      let consecutiveFailures = 0

      while (!handle.signal.aborted) {
        // Backs off as failures mount, so a struggling server isn't polled
        // every 1.2s by every waiting page.
        const wait = POLL_MS * Math.min(1 + consecutiveFailures, 5)
        await new Promise((resolve) => setTimeout(resolve, wait))
        if (handle.signal.aborted) return

        try {
          const response = await fetch(handle.props.statusHref, {
            headers: { Accept: 'application/json' },
            signal: handle.signal,
          })

          // A swept job is gone for good — say so rather than waiting on
          // something that will never answer.
          if (response.status === 404) {
            failed = "This run is no longer available. It may have finished a while ago."
            handle.update()
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
            handle.update()
            return
          }

          // Navigating away is the end of the wait, so the loop stops here
          // rather than polling a job that has finished.
          if (status.done && status.href) {
            window.location.href = status.href
            return
          }

          if (status.status !== queueState || status.phase !== phase || status.queuedAhead !== ahead) {
            queueState = status.status
            phase = status.phase
            ahead = status.queuedAhead
            handle.update()
          }
        } catch {
          consecutiveFailures++
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return void giveUp()
        }
      }
    }

    function giveUp() {
      lostContact = true
      handle.update()
    }

    void poll()

    return () => {
      const { phases, labels } = handle.props
      const current = phases.indexOf(phase)

      if (failed) return <p mix={css({ color: '#b91c1c' })}>{failed}</p>

      if (lostContact) {
        return (
          <p mix={css({ color: '#b91c1c' })}>
            Lost contact with the server. Your picks are probably still being put together —{' '}
            <a href="">reload</a> to check.
          </p>
        )
      }

      // Queued reads as its own state rather than a dimmed first step: the run
      // hasn't started, and showing stage one as "in progress" would be a lie.
      if (queueState === 'queued') {
        return (
          <p mix={css({ color: '#555' })}>
            Waiting to start
            {ahead != null && ahead > 0 ? ` — ${ahead} ${ahead === 1 ? 'run' : 'runs'} ahead of yours` : ''}
            …
          </p>
        )
      }

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
  },
)
