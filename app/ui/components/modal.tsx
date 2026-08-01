import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

type CSSStyle = Parameters<typeof css>[0]

// Computed selector keys need the Record<string, unknown> cast — same as
// tabsStyle in media-tabs.tsx.
function modalStyle(id: string): CSSStyle {
  const style: Record<string, unknown> = {
    '& .modal-toggle': {
      position: 'absolute',
      width: 0,
      height: 0,
      opacity: 0,
      pointerEvents: 'none',
    },
    '& .modal-overlay': {
      display: 'none',
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      zIndex: 1000,
    },
  }
  style[`&:has(#${id}:checked) .modal-overlay`] = { display: 'flex' }
  return style as CSSStyle
}

// A CSS-only modal (no JS), driven by a visually-hidden checkbox.
//
// This used to key off `:target` with the trigger as a link to `#<id>`. That
// worked, but put modal state in the URL: opening pushed a history entry, so
// after submitting the form and being redirected away, pressing Back returned
// to the fragment and silently reopened the modal over the page. A checkbox
// holds the same state without touching history, so Back now does what you'd
// expect.
//
// The trigger's look lives on an inner <span>, not the <label>: DoodleCSS
// sets `.doodle label { padding: .25em 0 }` outside any @layer, and unlayered
// rules beat layered ones regardless of specificity, so padding set on the
// label itself is silently discarded.
export function Modal(
  handle: Handle<{ id: string; triggerLabel: string; title?: string; fab?: boolean; children?: RemixNode }>,
) {
  return () => {
    const { id, triggerLabel, title, fab, children } = handle.props

    return (
      <div mix={css(modalStyle(id))}>
        <input type="checkbox" id={id} class="modal-toggle" />

        <label
          for={id}
          mix={css(
            fab
              ? { position: 'fixed', bottom: '24px', right: '24px', zIndex: 900, cursor: 'pointer' }
              : { cursor: 'pointer' },
          )}
        >
          <span
            class="doodle-border"
            mix={css(
              fab
                ? {
                    display: 'inline-block',
                    padding: '14px 22px',
                    textAlign: 'center',
                    backgroundColor: '#fdf7f1',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
                  }
                : { display: 'inline-block', padding: '4px 14px' },
            )}
          >
            {triggerLabel}
          </span>
        </label>

        <div class="modal-overlay">
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
              <label for={id} mix={css({ cursor: 'pointer' })}>
                <span mix={css({ fontSize: '20px' })}>✕</span>
              </label>
            </div>
            {children}
          </div>
        </div>
      </div>
    )
  }
}
