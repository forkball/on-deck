import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

// The log control's two states — a plus for a work not yet logged, a pencil for
// one that is — on every page that offers one, drawn at the notification bell's
// weight. Decorative: the trigger they sit in carries the words as its name.
function TriggerIcon(handle: Handle<{ children?: RemixNode }>) {
  return () => (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      mix={css({ display: 'block' })}
    >
      {handle.props.children}
    </svg>
  )
}

export function PlusIcon() {
  return () => (
    <TriggerIcon>
      <path d="M12 5v14M5 12h14" />
    </TriggerIcon>
  )
}

export function PencilIcon() {
  return () => (
    <TriggerIcon>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </TriggerIcon>
  )
}
