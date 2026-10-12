import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// The ring shown beside "Searching…"/"Importing…" while a request is in
// flight. Decorative: the text next to it says what is happening.
const spinnerStyle = css({
  '@keyframes spinner-spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
  display: 'inline-block',
  width: '13px',
  height: '13px',
  borderRadius: '50%',
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
  animation: 'spinner-spin 0.6s linear infinite',
  // Slowed rather than stopped: a still ring with a gap in it doesn't read
  // as "working".
  '@media (prefers-reduced-motion: reduce)': { animationDuration: '2s' },
})

// `size` for a ring standing in for a whole list rather than beside a word.
export function Spinner(handle: Handle<{ size?: number }>) {
  return () => {
    const { size } = handle.props
    return (
      <span
        aria-hidden="true"
        mix={[
          spinnerStyle,
          size ? css({ width: `${size}px`, height: `${size}px`, borderWidth: '3px' }) : undefined,
        ]}
      />
    )
  }
}
