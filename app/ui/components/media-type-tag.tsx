import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'

// Says what kind of thing a page is about — "Movie", "TV show" — in small
// capitals over its title, with a dot in the type's colour. A title alone
// doesn't say it: "Dune" is a book, two films and a game.
export function MediaTypeTag(handle: Handle<{ type: ActiveMediaType }>) {
  return () => {
    const { singular, hue } = MEDIA_TYPE_UI[handle.props.type]

    return (
      <span
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        })}
      >
        <span
          aria-hidden="true"
          mix={css({ width: '8px', height: '8px', borderRadius: '50%', background: hue, flex: '0 0 auto' })}
        />
        {singular}
      </span>
    )
  }
}
