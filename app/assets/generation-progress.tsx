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
  phases: string[]
  labels: Record<string, string>
}

export const GenerationProgress = clientEntry<GenerationProgressProps>(
  import.meta.url,
  function GenerationProgress(handle: Handle<GenerationProgressProps>) {
    let phase = handle.props.initialPhase
    let failed: string | null = null

    async function poll() {
      while (!handle.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (handle.signal.aborted) return

        try {
          const response = await fetch(handle.props.statusHref, {
            headers: { Accept: 'application/json' },
            signal: handle.signal,
          })
          if (!response.ok) return

          const status = (await response.json()) as {
            phase: string
            done: boolean
            href: string | null
            error: string | null
          }

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

          if (status.phase !== phase) {
            phase = status.phase
            handle.update()
          }
        } catch {
          // A dropped poll isn't fatal — the next one will catch up, and the
          // <noscript> refresh is a further backstop.
          return
        }
      }
    }

    void poll()

    return () => {
      const { phases, labels } = handle.props
      const current = phases.indexOf(phase)

      if (failed) return <p mix={css({ color: '#b91c1c' })}>{failed}</p>

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
