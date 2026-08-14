import type { Handle } from 'remix/ui'
import { clientEntry, css, ref } from 'remix/ui'

// Polls for the stage a run is actually in. Not on a timer: every label here
// comes from the server having entered that stage, so progress can't run
// backwards the way invented captions on a loop did.
//
// Comments here ship to the browser with the bundle, so this names neither the
// model vendor nor the catalog.
const POLL_MS = 1200

// A poll can fail for reasons unrelated to the run — a deploy, a dropped
// connection. Returning on the first one froze the page on its last stage while
// the run finished fine behind it.
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

// A type alias, not an interface — client entry props need SerializableProps'
// index signature, which an interface doesn't provide.
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

    // handle.update() hands back a promise the runtime settles on the next
    // render, and rejects it when there's no renderer to schedule against.
    // Called bare from the loop below, that rejection had nothing to catch it,
    // and an unhandled rejection ends the process rather than the request.
    // Swallowed instead: a dropped update costs a frame, and the state it was
    // announcing is read out of this closure by whichever render comes next.
    function render(): void {
      void handle.update().catch(() => {})
    }

    async function poll(signal: AbortSignal) {
      let consecutiveFailures = 0

      while (!signal.aborted) {
        // Backs off as failures mount.
        const wait = POLL_MS * Math.min(1 + consecutiveFailures, 5)
        await new Promise((resolve) => setTimeout(resolve, wait))
        if (signal.aborted) return

        try {
          const response = await fetch(handle.props.statusHref, {
            headers: { Accept: 'application/json' },
            signal,
          })

          // A swept job is gone for good.
          if (response.status === 404) {
            failed = "This run is no longer available. It may have finished a while ago."
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

          // Stop rather than polling a finished job.
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
        if (failed) return <p mix={css({ color: '#b91c1c' })}>{failed}</p>

        if (lostContact) {
          return (
            <p mix={css({ color: '#b91c1c' })}>
              Lost contact with the server. Your picks are probably still being put together —{' '}
              <a href="">reload</a> to check.
            </p>
          )
        }

        // Its own state, not a dimmed first step — the run hasn't started.
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

      // Polling starts here rather than in the setup above, which is the whole
      // point of this wrapper. The setup runs on the server too, to build the
      // first paint; a loop started there fetches a relative URL that can't
      // resolve, gives up after eight tries, and takes the server process down
      // with it. A ref only ever fires in a browser, against a real node.
      //
      // It has to be a wrapper and not the panel itself: ref fires on insert
      // and aborts on remove, and the panel swaps between a paragraph and a
      // list as the run moves. Hung on that, every swap would abort the loop
      // mid-run and start another. This element is the one thing on the page
      // that survives all of it — display: contents so that being here changes
      // nothing about how the panel lays out.
      return (
        <div mix={[css({ display: 'contents' }), ref((_node, signal) => void poll(signal))]}>{panel()}</div>
      )
    }
  },
)
