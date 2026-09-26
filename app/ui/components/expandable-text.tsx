import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// Roughly one clamped line at the detail page's width. Only decides whether a
// toggle is worth rendering — CSS does the clamping. Erring low costs a
// redundant toggle; erring high clips text with no way to expand it.
const CHARS_PER_LINE = 80

// Computed selector keys infer a string index signature CSSProps rejects —
// same as tabsStyle in media-tabs.tsx.
type CSSStyle = Parameters<typeof css>[0]

// Descriptions arrive with their paragraph breaks as newlines; without this
// they collapse and a multi-paragraph synopsis renders as one block.
const paragraphStyle = { whiteSpace: 'pre-line' } as const

function clampStyle(id: string, maxLines: number): CSSStyle {
  const style: Record<string, unknown> = {
    '& input[type="checkbox"]': {
      position: 'absolute',
      width: 0,
      height: 0,
      opacity: 0,
      pointerEvents: 'none',
    },
    '& .clamped': {
      ...paragraphStyle,
      display: '-webkit-box',
      WebkitLineClamp: String(maxLines),
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      margin: 0,
    },
    // On wrapper <span>s, not the <label>s: DoodleCSS sets `.doodle label`
    // display unlayered, so `display: none` on a label is ignored and both
    // toggles render at once.
    '& .toggle': { display: 'block', marginTop: '6px' },
    '& .less': { display: 'none' },
  }
  style[`&:has(#${id}:checked) .clamped`] = { display: 'block', overflow: 'visible' }
  style[`&:has(#${id}:checked) .more`] = { display: 'none' }
  style[`&:has(#${id}:checked) .less`] = { display: 'block' }
  return style as CSSStyle
}

export interface ExpandableTextProps {
  text: string
  // Must be unique on the page — drives the checkbox id the CSS keys off.
  id: string
  maxLines?: number
}

// CSS-only, like the rest of the app: a hidden checkbox holds the state and two
// toggles swap places, so no hydration. `-webkit-line-clamp` does the clamping
// and, despite the prefix, is supported everywhere current.
export function ExpandableText(handle: Handle<ExpandableTextProps>) {
  return () => {
    const { text, id, maxLines = 5 } = handle.props

    // Short enough that a toggle would be noise — render it plainly.
    if (text.length <= CHARS_PER_LINE * maxLines) {
      return <p mix={css(paragraphStyle)}>{text}</p>
    }

    const toggle = css({
      cursor: 'pointer',
      fontSize: '13px',
      color: '#555',
      textDecoration: 'underline',
    })

    return (
      <div mix={css(clampStyle(id, maxLines))}>
        <input type="checkbox" id={id} />
        <p class="clamped">{text}</p>
        <span class="toggle more">
          <label for={id} mix={toggle}>
            Read more
          </label>
        </span>
        <span class="toggle less">
          <label for={id} mix={toggle}>
            Read less
          </label>
        </span>
      </div>
    )
  }
}
