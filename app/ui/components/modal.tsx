import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { ToggleLabel } from '../shared/form-controls.tsx'

type CSSStyle = Parameters<typeof css>[0]

// Computed selector keys need the cast — same as tabsStyle in media-tabs.tsx.
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

// CSS-only, driven by a visually-hidden checkbox. Deliberately not `:target`,
// which put modal state in the URL — after submitting and being redirected
// away, Back returned to the fragment and silently reopened the modal.
//
// The trigger is a ToggleLabel drawn as a button; the fab's larger frame,
// paper and shadow are `label.modal-fab` in app.css.
export function Modal(
  handle: Handle<{
    id: string
    // Omitted when nothing opens this by hand — see PasswordConfirmModal,
    // which is opened by a form submit or by the server rendering it open.
    triggerLabel?: string
    title?: string
    fab?: boolean
    // Renders already open. The server needs this to put a rejected modal
    // form back in front of someone — without it a 400 comes back as a page
    // with the error hidden behind a trigger they'd have to find again.
    defaultOpen?: boolean
    // False when the content has its own way out.
    closeButton?: boolean
    children?: RemixNode
  }>,
) {
  return () => {
    const { id, triggerLabel, title, fab, defaultOpen, closeButton = true, children } = handle.props

    return (
      <div mix={css(modalStyle(id))}>
        <input type="checkbox" id={id} class="modal-toggle" checked={defaultOpen} />

        {triggerLabel && (
          <ToggleLabel
            for={id}
            variant="button"
            class={fab ? 'modal-fab' : undefined}
            mix={fab ? css({ position: 'fixed', bottom: '24px', right: '24px', zIndex: 900 }) : undefined}
          >
            {triggerLabel}
          </ToggleLabel>
        )}

        <div class="modal-overlay">
          <div
            mix={css({
              backgroundColor: 'var(--paper)',
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
              {closeButton && (
                <ToggleLabel for={id} tapArea>
                  <span mix={css({ fontSize: '20px' })}>✕</span>
                </ToggleLabel>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    )
  }
}
