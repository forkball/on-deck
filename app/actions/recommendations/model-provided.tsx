import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface ModelProvidedProps {
  children?: RemixNode
  // What the tooltip says: where this value came from and what checked it, in the
  // reader's terms rather than the pipeline's.
  note: string
}

// Marks a value on the page as the model's answer rather than the catalog's.
//
// Most of what a run shows is catalog data — title, year, cover, tags, page count —
// and a few things can only come from the model: why a pick was made at all, and the
// levers no provider can answer (see matchesSeries and decadeYear). Those read
// identically once rendered, which is the problem this solves: someone reading
// "1960s" has no way to tell whether a catalogue confirmed it.
//
// A native title attribute, as elsewhere in the app, so it needs no JavaScript and
// survives the noscript path. The dotted underline is what makes it discoverable —
// a tooltip nobody knows to hover is decoration.
export function ModelProvided(handle: Handle<ModelProvidedProps>) {
  return () => {
    const { note, children } = handle.props

    return (
      <span title={note} mix={css({ borderBottom: '1px dotted #999', cursor: 'help' })}>
        {children}
      </span>
    )
  }
}
