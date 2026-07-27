import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// A CSS-only floating dropdown anchored to its trigger, using the native
// <details>/<summary> disclosure (no JS, no shared URL-fragment state, so
// many of these can exist independently on one page — e.g. one per search
// result row).
export function FloatingDropdown(handle: Handle<{ triggerLabel: string; children?: RemixNode }>) {
  return () => {
    const { triggerLabel, children } = handle.props

    return (
      <details mix={css({ position: 'relative', display: 'inline-block' })}>
        <summary
          class="doodle-border"
          mix={css({
            cursor: 'pointer',
            listStyle: 'none',
            display: 'inline-block',
            padding: '4px 14px',
            '&::-webkit-details-marker': { display: 'none' },
          })}
        >
          {triggerLabel}
        </summary>
        <div
          mix={css({
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 10,
            backgroundColor: '#fdf7f1',
            border: '1px solid #3c3c3c',
            borderRadius: '8px',
            padding: '12px',
            minWidth: '240px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          })}
        >
          {children}
        </div>
      </details>
    )
  }
}
