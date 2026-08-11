import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// Rendered on both sides, so it lives in app/ui/shared — the narrow slice of
// app/ui the asset allowlist covers — rather than app/ui/components, which
// reaches routes and the media-type registry and so can't be bundled.

// Stacks the label above its control and makes the control span the field.
//
// `width: 100%` on the label is load-bearing and not interchangeable with
// display. DoodleCSS sets `.doodle label { display: inline-block }` outside
// any @layer, and unlayered declarations beat layered ones regardless of
// specificity — so `display: flex` here is silently discarded and the label
// stays inline-block, i.e. shrink-to-fit. A child's `width: 100%` then
// resolves against that shrunken box, which is why the control came out
// narrow. Doodle sets no *width* on labels, so setting it explicitly is the
// one instruction that survives.
//
// Stacking then falls out without flex: the label text is inline, the
// control is block, and a block element always starts on its own line.
export const fieldStyle = css({
  width: '100%',
  // Targeted by class rather than `& > span`, which would also catch the
  // hint and fight its own margin.
  '& > .field-label': {
    display: 'block',
    marginBottom: '4px',
  },
  '& select, & input, & textarea': {
    display: 'block',
    width: '100%',
  },
})

const labelTextStyle = css({ fontSize: '13px', color: '#555' })
const hintStyle = css({ display: 'block', margin: '4px 0 0', fontSize: '12px', color: '#888' })
const errorStyle = css({ display: 'block', margin: '4px 0 0', fontSize: '12px', color: '#b91c1c' })

export interface FieldProps {
  label: string
  children?: RemixNode
  // Helper text under the control — e.g. explaining what a filter does.
  hint?: RemixNode
  // Why this field was rejected, rendered under the control. Sits inside the
  // <label> so a screen reader reads it with the field it belongs to.
  error?: string
}

// The single way to render a labelled control. Every text input, select and
// textarea in the app goes through this so they can't drift apart.
export function Field(handle: Handle<FieldProps>) {
  return () => {
    const { label, children, hint, error } = handle.props

    return (
      <label mix={fieldStyle}>
        <span class="field-label" mix={labelTextStyle}>
          {label}
        </span>
        {children}
        {error && <span mix={errorStyle}>{error}</span>}
        {hint && <span mix={hintStyle}>{hint}</span>}
      </label>
    )
  }
}
