import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// Same reason as field.tsx for living here: app/ui/shared is the part of app/ui
// that client entries are allowed to import.

const boxedBodyStyle = css({
  border: '1px solid var(--rule)',
  borderRadius: '8px',
  padding: '16px',
  marginTop: '12px',
})

export interface CollapsibleProps {
  summary: RemixNode
  children?: RemixNode
  // Open on first paint. Closed by default — the point is to keep secondary
  // controls out of the way.
  open?: boolean
  // Wraps the body in the same bordered panel the profile's taste-profile
  // disclosure uses. Off for inline groups that already sit inside a card.
  boxed?: boolean
}

// The chevron at the right end of a disclosure's summary, which turns over
// when it opens. Its look is `.disclosure-chevron` in app.css; a summary with
// `class="disclosure"` puts it at the far end of the row.
export function DisclosureChevron() {
  return () => <span class="disclosure-chevron" aria-hidden="true" />
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
        <summary class="disclosure">
          <span>{summary}</span>
          <DisclosureChevron />
        </summary>
        {boxed ? <div mix={boxedBodyStyle}>{children}</div> : children}
      </details>
    )
  }
}
