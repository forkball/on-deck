import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Link } from '../shared/form-controls.tsx'

const titleStyle = css({
  margin: '-12px 0 12px',
  fontStyle: 'italic',
  fontWeight: 600,
  color: 'var(--accent)',
})

const hintStyle = css({ fontStyle: 'normal', fontWeight: 400, fontSize: '14px' })

// The title a member wears, on the line under their name. Shared by the profile
// you see of yourself and the one other people see.
//
// `href` is where it leads: your own credits in settings, or someone else's
// credits page — left off when their profile is private to you, since what
// they've earned says what they've logged. `fallback` is the line shown in its
// place when no title is worn. `margin` is for the page under it: the heading
// above isn't spaced the same on both profiles.
export function UserTitle(
  handle: Handle<{ title: string | null; href?: string; fallback?: string; margin?: string }>,
) {
  return () => {
    const { title, href, fallback, margin } = handle.props
    const placed = margin ? css({ margin }) : undefined

    if (!title) {
      return href && fallback ? (
        <p mix={[titleStyle, hintStyle, placed]}>
          <Link href={href}>{fallback}</Link>
        </p>
      ) : null
    }

    return <p mix={[titleStyle, placed]}>{href ? <Link href={href}>{title}</Link> : title}</p>
  }
}
