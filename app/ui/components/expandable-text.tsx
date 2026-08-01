import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// Roughly how many characters fit in one clamped line at the detail page's
// column width. Only used to decide whether a toggle is worth rendering at
// all — CSS does the actual clamping, so being approximate is fine. Erring
// low just means a short paragraph occasionally gets a redundant toggle;
// erring high would clip text with no way to expand it, which is worse.
const CHARS_PER_LINE = 80

// Computed selector keys make TypeScript infer a string index signature that
// CSSProps rejects — same situation as tabsStyle in media-tabs.tsx, and the
// same fix.
type CSSStyle = Parameters<typeof css>[0]

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
      display: '-webkit-box',
      WebkitLineClamp: String(maxLines),
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      margin: 0,
    },
    // The toggles live on wrapper <span>s, not on the <label>s themselves.
    // DoodleCSS sets `.doodle label { display: inline-block }` *outside* any
    // @layer, and unlayered declarations beat layered ones no matter how
    // specific the layered selector is — so `display: none` on a label is
    // silently ignored and both toggles render at once. Spans are untouched
    // by doodle, so hiding those works.
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

// Clamps long prose to `maxLines` with a Read more / Read less toggle.
//
// CSS-only, matching the rest of the app (see media-tabs.tsx for the same
// `:has(#id:checked)` pattern): a visually-hidden checkbox holds the state and
// two toggles swap places, so this works with JS disabled and needs no
// hydration. Line clamping itself is `-webkit-line-clamp`, which despite the
// prefix is supported across every current browser.
export function ExpandableText(handle: Handle<ExpandableTextProps>) {
  return () => {
    const { text, id, maxLines = 5 } = handle.props

    // Short enough that a toggle would be noise — render it plainly.
    if (text.length <= CHARS_PER_LINE * maxLines) {
      return <p>{text}</p>
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
