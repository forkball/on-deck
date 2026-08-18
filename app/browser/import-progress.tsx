import { clientEntry, css, ref } from 'remix/ui'

export type ImportProgressProps = {
  progressHref: string
  reviewHref: string
  // The server-rendered bar and label are updated in place rather than
  // re-rendered here, so the page says something true with JS off and this only
  // keeps it current.
  barId: string
  labelId: string
}

const POLL_MS = 1500

// Matching runs on a worker, so the page has to ask how far along it is. Polls
// counts rather than reloading: a reload would throw away scroll position every
// couple of seconds for a page whose only moving part is two numbers.
export const ImportProgress = clientEntry<ImportProgressProps>(
  import.meta.url,
  function ImportProgress(handle) {
    return () => {
      const { progressHref, reviewHref, barId, labelId } = handle.props

      return (
        <span
          mix={[
            css({ display: 'none' }),
            ref((_node, signal) => {
              let timer: ReturnType<typeof setTimeout> | undefined

              const stop = () => clearTimeout(timer)
              signal.addEventListener('abort', stop)

              async function poll() {
                try {
                  const response = await fetch(progressHref, { signal })
                  if (!response.ok) throw new Error(String(response.status))

                  const data = (await response.json()) as {
                    status: string
                    total: number
                    matched: number
                  }

                  const bar = document.getElementById(barId)
                  const label = document.getElementById(labelId)
                  const percent = data.total === 0 ? 0 : Math.min(100, Math.round((data.matched / data.total) * 100))

                  if (bar) bar.style.width = `${percent}%`
                  if (label) label.textContent = `${data.matched} of ${data.total} rows`

                  if (data.status === 'review' || data.status === 'done') {
                    window.location.href = reviewHref
                    return
                  }
                  // A failed batch is rendered by the server, which has the
                  // message; reloading is how the page gets it.
                  if (data.status === 'failed') {
                    window.location.reload()
                    return
                  }
                } catch (error) {
                  if (error instanceof DOMException && error.name === 'AbortError') return
                  // A dropped poll is not a dropped import — the worker carries
                  // on regardless, so this just tries again.
                }

                timer = setTimeout(poll, POLL_MS)
              }

              timer = setTimeout(poll, POLL_MS)
            }),
          ]}
        />
      )
    }
  },
)
