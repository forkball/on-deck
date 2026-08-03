import { clientEntry, css, ref } from 'remix/ui'

export type ProfileMenuLink = {
  href: string
  label: string
}

export type ProfileMenuProps = {
  displayName: string
  links: ProfileMenuLink[]
  logoutHref: string
}

// <details>/<summary> drives the toggle with no JS, but closing on an outside
// click needs real click handling. A :focus-within version raced with the
// menu's own links — Safari doesn't focus a plain <a> on click, so blur-close
// hid the menu before the click landed.
//
// URLs arrive as plain string props: the browser bundle is limited to
// app/browser/**, and routes.ts lives outside it.
export const ProfileMenu = clientEntry<ProfileMenuProps>(import.meta.url, function ProfileMenu(handle) {
  return () => {
    const { displayName, links, logoutHref } = handle.props

    return (
      <details
        mix={[
          css({
            position: 'relative',
            '& summary': {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              listStyle: 'none',
            },
            '& summary::-webkit-details-marker': {
              display: 'none',
            },
            '& .trigger-label': {
              textDecoration: 'underline',
            },
            '& .chevron': {
              display: 'inline-block',
              fontSize: '10px',
              transition: 'transform 0.15s ease',
            },
            '&[open] .chevron': {
              transform: 'rotate(180deg)',
            },
            '& .menu': {
              display: 'flex',
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 10,
              flexDirection: 'column',
              gap: '4px',
              marginTop: '4px',
              minWidth: '180px',
              padding: '8px',
              backgroundColor: '#fdf7f1',
              border: '1px solid #3c3c3c',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            },
            '& .menu a': {
              padding: '4px 8px',
            },
            '& .menu form': {
              margin: 0,
            },
            '& .menu button': {
              width: '100%',
              textAlign: 'left',
            },
          }),
          ref((node, signal) => {
            const details = node as HTMLDetailsElement
            const summary = details.querySelector('summary')

            document.addEventListener(
              'click',
              (event) => {
                if (!details.open) return
                if (summary?.contains(event.target as Node)) return
                details.open = false
              },
              { signal },
            )
          }),
        ]}
      >
        <summary aria-haspopup="true">
          <span class="trigger-label">{displayName || 'My Profile'}</span>
          <span class="chevron" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div class="menu">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <form method="post" action={logoutHref}>
            <button type="submit">Log out</button>
          </form>
        </div>
      </details>
    )
  }
})
