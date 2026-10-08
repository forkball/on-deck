import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// A link after the message, where there is somewhere to go about it — the run
// already in progress, when that is why this one was refused.
export interface ErrorLink {
  href: string
  label: string
}

// Why a request from the recommendations form or the lucky page was refused, at the
// top of the page it bounced back to. One box for both, so the two can't drift.
export function ErrorNotice(handle: Handle<{ error: string; link?: ErrorLink }>) {
  return () => {
    const { error, link } = handle.props
    return (
      <p
        mix={css({
          margin: '0 0 16px',
          padding: '12px 16px',
          border: '1px solid #b91c1c',
          borderRadius: '8px',
          color: '#b91c1c',
        })}
      >
        {error}
        {link && (
          <>
            {' '}
            <a href={link.href}>{link.label}</a>
          </>
        )}
      </p>
    )
  }
}
