import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// Same reason as field.tsx for living here: app/assets/lib is the only place
// both islands and server components can import from.

const summaryStyle = css({ cursor: 'pointer' })
const boxedBodyStyle = css({
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '16px',
  marginTop: '12px',
})

export interface CollapsibleProps {
  summary: RemixNode
  children?: RemixNode
  // Open on first paint. Left closed by default, since the point of a
  // collapsible is to keep secondary controls out of the way.
  open?: boolean
  // Wraps the body in the same bordered panel the profile's taste-profile
  // disclosure uses. Off for inline groups that already sit inside a card.
  boxed?: boolean
}

// A plain <details>/<summary> disclosure, matching the one on the profile.
//
// Deliberately native rather than the checkbox+`:has()` trick used for the
// tabs and modal: <details> already has the right semantics and keyboard
// behaviour, and unlike a modal there's no reason to keep the open state out
// of the element itself.
export function Collapsible(handle: Handle<CollapsibleProps>) {
  return () => {
    const { summary, children, open, boxed } = handle.props

    return (
      <details open={open}>
        <summary mix={summaryStyle}>{summary}</summary>
        {boxed ? <div mix={boxedBodyStyle}>{children}</div> : children}
      </details>
    )
  }
}
