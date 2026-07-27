import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// A CSS-only modal (no JS): the trigger is a same-page link to `#<id>`, and
// the overlay uses `:target` to show itself only when its own id matches the
// URL fragment. Closing is a link back to a bare `#`, which clears the
// fragment so `:target` stops matching.
export function Modal(
  handle: Handle<{ id: string; triggerLabel: string; title?: string; fab?: boolean; children?: RemixNode }>,
) {
  return () => {
    const { id, triggerLabel, title, fab, children } = handle.props

    return (
      <>
        <a
          href={`#${id}`}
          class="doodle-border"
          mix={css(
            fab
              ? {
                  display: 'inline-block',
                  position: 'fixed',
                  bottom: '24px',
                  right: '24px',
                  zIndex: 900,
                  padding: '14px 22px',
                  textDecoration: 'none',
                  textAlign: 'center',
                  backgroundColor: '#fdf7f1',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
                }
              : { display: 'inline-block', padding: '4px 14px', textDecoration: 'none' },
          )}
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
            <div
              mix={css({
                display: 'flex',
                justifyContent: title ? 'space-between' : 'flex-end',
                alignItems: 'center',
                gap: '12px',
                marginBottom: title ? '16px' : '8px',
              })}
            >
              {title && <h3 mix={css({ margin: 0 })}>{title}</h3>}
              <a href="#" mix={css({ textDecoration: 'none', fontSize: '20px' })}>
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
