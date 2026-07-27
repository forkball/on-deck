import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// A CSS-only modal (no JS): the trigger is a same-page link to `#<id>`, and
// the overlay uses `:target` to show itself only when its own id matches the
// URL fragment. Closing is a link back to a bare `#`, which clears the
// fragment so `:target` stops matching.
export function Modal(handle: Handle<{ id: string; triggerLabel: string; children?: RemixNode }>) {
  return () => {
    const { id, triggerLabel, children } = handle.props

    return (
      <>
        <a
          href={`#${id}`}
          class="doodle-border"
          mix={css({ display: 'inline-block', padding: '4px 14px', textDecoration: 'none' })}
        >
          {triggerLabel}
        </a>
        <div
          id={id}
          mix={css({
            display: 'none',
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
            '&:target': { display: 'flex' },
          })}
        >
          <div
            mix={css({
              backgroundColor: '#fdf7f1',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
            })}
          >
            <div mix={css({ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' })}>
              <a href="#" mix={css({ textDecoration: 'none', fontSize: '20px', color: '#3c3c3c' })}>
                ✕
              </a>
            </div>
            {children}
          </div>
        </div>
      </>
    )
  }
}
