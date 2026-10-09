import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { FloatingDropdownCloser } from '../../browser/floating-dropdown-closer.tsx'
import { buttonFrameClass } from '../shared/form-controls.tsx'

// Native <details>/<summary>, so many can exist independently on one page —
// one per search result row.
export function FloatingDropdown(
  handle: Handle<{
    triggerLabel: string
    children?: RemixNode
    // A trigger at the right edge of its container needs 'right', or the
    // 240px panel opens off the side of the page.
    align?: 'left' | 'right'
    // A trigger that sits beside a heading rather than in a row of buttons:
    // the same sketched border, drawn at half the width.
    compact?: boolean
    // Drawn in place of the label, which becomes the trigger's accessible name
    // and tooltip — for a row too narrow to spare the words.
    icon?: RemixNode
  }>,
) {
  return () => {
    const { triggerLabel, children, align = 'left', compact, icon } = handle.props

    return (
      <details mix={css({ position: 'relative', display: 'inline-block' })}>
        <summary
          // `icon` and `compact` are sized in app.css: `.doodle-border` is
          // unlayered, so a css() mix can't set its border width.
          class={buttonFrameClass('default', icon ? 'icon' : compact ? 'compact' : undefined)}
          aria-label={icon ? triggerLabel : undefined}
          title={icon ? triggerLabel : undefined}
          mix={css({
            cursor: 'pointer',
            listStyle: 'none',
            display: 'inline-block',
            '&::-webkit-details-marker': { display: 'none' },
          })}
        >
          {icon ?? triggerLabel}
        </summary>
        <div
          mix={css({
            position: 'absolute',
            top: 'calc(100% + 4px)',
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 10,
            backgroundColor: 'var(--paper)',
            border: '1px solid var(--text)',
            borderRadius: '8px',
            padding: '12px',
            minWidth: '240px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          })}
        >
          {children}
        </div>
        <FloatingDropdownCloser />
      </details>
    )
  }
}
