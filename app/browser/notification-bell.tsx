import { clientEntry, css, ref } from 'remix/ui'

export type NotificationBellProps = {
  href: string
  countHref: string
}

const BELL_SIZE = 20

function BellIcon() {
  return () => (
    <svg viewBox="0 0 24 24" width={BELL_SIZE} height={BELL_SIZE} mix={css({ display: 'block' })}>
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        fill="none"
        stroke="#3c3c3c"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        fill="none"
        stroke="#3c3c3c"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// Fetches its own unread count on mount rather than taking it as a prop, so the
// bell doesn't have to be threaded through every controller that renders <Nav>.
export const NotificationBell = clientEntry<NotificationBellProps>(
  import.meta.url,
  function NotificationBell(handle) {
    let count = 0
    let loaded = false

    return () => {
      const { href, countHref } = handle.props

      return (
        <a
          href={href}
          aria-label="Notifications"
          mix={[
            css({
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }),
            ref((node, signal) => {
              fetch(countHref, { signal })
                .then((response) => (response.ok ? response.json() : { count: 0 }))
                .then((data: { count: number }) => {
                  count = data.count
                  loaded = true
                  handle.update()
                })
                .catch(() => {})
            }),
          ]}
        >
          <BellIcon />
          {loaded && count > 0 && (
            <span
              mix={css({
                position: 'absolute',
                top: '-4px',
                right: '-8px',
                minWidth: '15px',
                padding: '1px 4px',
                borderRadius: '999px',
                backgroundColor: '#b91c1c',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 700,
                lineHeight: '13px',
                textAlign: 'center',
              })}
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </a>
      )
    }
  },
)
