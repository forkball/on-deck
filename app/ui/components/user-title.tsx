import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Link } from '../shared/form-controls.tsx'

const titleStyle = css({
  margin: '-12px 0 12px',
  fontStyle: 'italic',
  fontWeight: 600,
  color: 'var(--accent)',
})

// The title a member wears, on the line under their name. Shared by the profile
// you see of yourself and the one other people see; only the first passes
// `href`, which is where it is changed.
// `margin` is for the page under it: the heading above isn't spaced the same
// on both profiles.
export function UserTitle(handle: Handle<{ title: string | null; href?: string; margin?: string }>) {
  return () => {
    const { title, href, margin } = handle.props
    const placed = margin ? css({ margin }) : undefined
    if (!title) {
      return href ? (
        <p mix={[titleStyle, css({ fontStyle: 'normal', fontWeight: 400, fontSize: '14px' }), placed]}>
          <Link href={href}>Earn yourself a title →</Link>
        </p>
      ) : null
    }

    return <p mix={[titleStyle, placed]}>{href ? <Link href={href}>{title}</Link> : title}</p>
  }
}
