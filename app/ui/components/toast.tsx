import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

export type ToastVariant = 'success' | 'error'

// A confirmation that doesn't move the page it's confirming.
//
// These were a <p> at the top of whatever page the action redirected to, which
// has two problems. It shifts everything below it down by a line, and it is
// only seen if it happens to land above the fold — the taste settings sit at
// the bottom of the edit page, so saving them redirected to a page whose
// "Saved." was some 800px below where the browser put you, and the save read
// as having done nothing at all.
//
// Fixed rather than in flow, so it can't move anything, and it fades itself
// out. The fade is CSS rather than a client entry: this has to work on a page
// with no JavaScript, and an animation does that without shipping a bundle to
// say one word.
//
// Errors don't fade. A confirmation you missed cost you nothing; a refusal you
// missed leaves you wondering why nothing happened, which is the state this
// component exists to prevent.
export function Toast(handle: Handle<{ message: string; variant?: ToastVariant }>) {
  return () => {
    const { message, variant = 'success' } = handle.props
    const isError = variant === 'error'

    return (
      <div
        mix={css({
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: '24px',
          display: 'flex',
          justifyContent: 'center',
          padding: '0 16px',
          // Never in the way of what's underneath: nothing here is clickable,
          // and it sits over the middle of the page.
          pointerEvents: 'none',
          zIndex: 50,
        })}
      >
        <p
          // Announced without stealing focus. A refusal is assertive, a
          // confirmation isn't worth interrupting anyone for.
          role={isError ? 'alert' : 'status'}
          aria-live={isError ? 'assertive' : 'polite'}
          mix={css({
            margin: 0,
            maxWidth: '480px',
            padding: '10px 16px',
            borderRadius: '8px',
            // Matches the page rather than sitting on it as a white card —
            // see doodle.css, which paints the body #FDF7F1.
            backgroundColor: '#FDF7F1',
            border: `1px solid ${isError ? '#b91c1c' : '#15803d'}`,
            color: isError ? '#b91c1c' : '#15803d',
            fontSize: '14px',
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.14)',
            ...(isError
              ? {}
              : {
                  '@keyframes toast-fade': {
                    '0%, 75%': { opacity: 1 },
                    // Hidden as well as transparent, or it keeps its corner of
                    // the page from the screen reader after it's gone.
                    '100%': { opacity: 0, visibility: 'hidden' },
                  },
                  animation: 'toast-fade 5s forwards',
                }),
          })}
        >
          {message}
        </p>
      </div>
    )
  }
}
