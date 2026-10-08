import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { Modal } from '../../../ui/components/modal.tsx'
import { Button } from '../../../ui/shared/form-controls.tsx'

const DISCARD_TOGGLE = 'import-discard-toggle'

// The way out of an unsaved import, from the matching page or the review.
// The link only opens the confirmation, which holds the form: a stray click
// would otherwise throw the whole review away.
export function DiscardImport(
  handle: Handle<{ href: string; label: string; cancelLabel: string; children: RemixNode }>,
) {
  return () => {
    const { href, label, cancelLabel, children } = handle.props

    return (
      <div>
        <label for={DISCARD_TOGGLE} class="linkish">
          {label}
        </label>
        <Modal id={DISCARD_TOGGLE} closeButton={false} title="Discard this import?">
          <p mix={css({ margin: '0 0 16px' })}>{children}</p>
          <div mix={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' })}>
            <form method="post" action={href}>
              <Button type="submit" variant="danger">
                Yes, discard it
              </Button>
            </form>
            <label for={DISCARD_TOGGLE} class="linkish">
              {cancelLabel}
            </label>
          </div>
        </Modal>
      </div>
    )
  }
}
