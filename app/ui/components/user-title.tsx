import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// Text colour, not the accent: the accent is what links are on this site, and
// a title in it read as something to click.
const titleStyle = css({
  margin: '-12px 0 12px',
  fontStyle: 'italic',
  fontWeight: 600,
  color: 'var(--soft)',
})

// The title a member wears, on the line under their name. Shared by the profile
// you see of yourself and the one other people see. Plain text: the credits
// behind it are the profile's Titles tab. Both profiles put it under Page's
// own heading, so one margin fits both.
export function UserTitle(handle: Handle<{ title: string | null }>) {
  return () => {
    const { title } = handle.props
    if (!title) return null
    return <p mix={titleStyle}>{title}</p>
  }
}
