import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

export interface GenerationFailureProps {
  message: string
  // Passed rather than built from routes.ts: this renders inside a client entry
  // too, and app/ui/shared may not reach the route table.
  backHref: string
}

// Why a run stopped, rendered identically either side of the poll — the server
// paints it on first load, the client entry repaints it when the status endpoint
// reports it, and copy that lived in both files would be reworded in one.
//
// The link is a way back, not advice. What to actually do differs per failure —
// widen a filter, wait for the catalog, try again after a crash — and every one of
// those is already said in `message`, which is written where the failure happened
// and knows which it is.
export function GenerationFailure(handle: Handle<GenerationFailureProps>) {
  return () => {
    const { message, backHref } = handle.props

    return (
      <>
        <p mix={css({ color: '#b91c1c' })}>{message}</p>
        <p>
          <a href={backHref}>Back to recommendations</a>
        </p>
      </>
    )
  }
}
