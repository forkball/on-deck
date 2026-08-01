import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// A carousel: one image at a time, with dots and prev/next.
//
// CSS-only, matching the tabs and the log modal — a hidden radio per slide
// and `:has(…:checked)` sliding the track. No JavaScript, and no URL state:
// anchor-based slides (`#slide-2`) would push a history entry each time, the
// same reason the log modal was moved off `:target`, so pressing back would
// step through images instead of leaving the page.
//
// The selectors key off `nth-of-type` rather than the ids, which keeps this
// one static stylesheet no matter how many carousels are on a page — only
// the `for`/`id` pairing needs to be unique per instance.
const MAX_STILLS = 3

const carouselStyle = css({
  position: 'relative',
  // Clips the slides that are translated out of view.
  overflow: 'hidden',
  borderRadius: '8px',
  // Each rule moves the track one full slide. Written out rather than
  // generated because MAX_STILLS is small and fixed.
  '&:has(input:nth-of-type(1):checked) > .carousel-track': { transform: 'translateX(0%)' },
  '&:has(input:nth-of-type(2):checked) > .carousel-track': { transform: 'translateX(-100%)' },
  '&:has(input:nth-of-type(3):checked) > .carousel-track': { transform: 'translateX(-200%)' },
  // The dot for the current slide, and the arrows that would leave the strip.
  '&:has(input:nth-of-type(1):checked) .carousel-dots > label:nth-of-type(1)': { background: '#3c3c3c' },
  '&:has(input:nth-of-type(2):checked) .carousel-dots > label:nth-of-type(2)': { background: '#3c3c3c' },
  '&:has(input:nth-of-type(3):checked) .carousel-dots > label:nth-of-type(3)': { background: '#3c3c3c' },
  // Only the arrow pair belonging to the current slide is shown, so each one
  // can point at a fixed neighbour instead of needing to know where it is.
  '& .carousel-nav': { display: 'none' },
  '&:has(input:nth-of-type(1):checked) .carousel-nav-0': { display: 'block' },
  '&:has(input:nth-of-type(2):checked) .carousel-nav-1': { display: 'block' },
  '&:has(input:nth-of-type(3):checked) .carousel-nav-2': { display: 'block' },
})

// Sits over the track without swallowing clicks; only the arrows take them.
const navStyle = css({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
})

// Visually hidden but still focusable, so arrow keys move through the slides
// the way they would in any radio group.
//
// `opacity` and `pointer-events` do the hiding rather than `border: 0` or a
// smaller box, because DoodleCSS gives `.doodle input[type=radio]` a 16px
// border-image and a `::after` glyph from outside any @layer — unlayered wins
// over anything here regardless of specificity, so the element is really ~33px
// however small this says it is. Transparent is enough for the eye; without
// pointer-events it would still be an invisible click target sitting over the
// top-left corner of the image, quietly changing slides.
const radioStyle = css({
  position: 'absolute',
  width: '1px',
  height: '1px',
  opacity: 0,
  margin: 0,
  pointerEvents: 'none',
})

const trackStyle = css({
  display: 'flex',
  transition: 'transform 0.3s ease',
  // Nobody asked for motion; respect that.
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

const slideStyle = css({
  flex: '0 0 100%',
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  background: '#eee',
  // No border-radius: DoodleCSS styles `.doodle img` outside any @layer, and
  // unlayered wins over anything layered regardless of specificity, so a
  // radius set here would be dead code. Slides get the same hand-drawn frame
  // as every other image in the app.
})

const dotsStyle = css({
  display: 'flex',
  justifyContent: 'center',
  gap: '8px',
  marginTop: '8px',
})

// Deliberately no `display` here. DoodleCSS forces `.doodle label` to
// inline-block from outside any layer, so setting it would be silently
// discarded — this has caught the project four times. Width and height are
// honoured on an inline-block box, which is all a dot needs.
const dotStyle = css({
  width: '10px',
  height: '10px',
  borderRadius: '999px',
  border: '1px solid #3c3c3c',
  background: 'transparent',
  cursor: 'pointer',
})

const arrowStyle = css({
  position: 'absolute',
  top: 'calc(50% - 18px)',
  width: '36px',
  height: '36px',
  lineHeight: '34px',
  textAlign: 'center',
  borderRadius: '999px',
  border: '1px solid #3c3c3c',
  background: 'rgba(253, 247, 241, 0.9)',
  cursor: 'pointer',
  userSelect: 'none',
  pointerEvents: 'auto',
})

export interface ImageCarouselProps {
  images: string[]
  title: string
  // Unique per carousel on the page — the radios need their own name, and the
  // dots need ids to point `for` at.
  id: string
}

export function ImageCarousel(handle: Handle<ImageCarouselProps>) {
  return () => {
    const { images, title, id } = handle.props
    const slides = images.slice(0, MAX_STILLS)
    const slideId = (index: number) => `${id}-slide-${index}`

    if (slides.length === 0) return <></>
    // One image isn't a carousel — no controls to offer.
    if (slides.length === 1) {
      return <img src={slides[0]} alt={`${title} artwork`} mix={slideStyle} />
    }

    return (
      <div mix={carouselStyle}>
        {slides.map((_, index) => (
          <input
            key={slideId(index)}
            type="radio"
            name={id}
            id={slideId(index)}
            checked={index === 0}
            aria-label={`Screenshot ${index + 1} of ${slides.length}`}
            mix={radioStyle}
          />
        ))}

        <div class="carousel-track" mix={trackStyle}>
          {slides.map((image, index) => (
            <img
              key={image}
              src={image}
              // The first stands in for the set; the rest are decorative and
              // gain a screen reader nothing by being enumerated.
              alt={index === 0 ? `${title} artwork` : ''}
              loading={index === 0 ? 'eager' : 'lazy'}
              mix={slideStyle}
            />
          ))}
        </div>

        {/* One pair per slide; the rules above reveal only the current pair,
            which is why each arrow can point at a fixed neighbour. */}
        {slides.map((_, index) => (
          <div key={`nav-${index}`} class={`carousel-nav carousel-nav-${index}`} mix={navStyle}>
            {index > 0 && (
              <label for={slideId(index - 1)} aria-hidden="true" mix={[arrowStyle, css({ left: '8px' })]}>
                ‹
              </label>
            )}
            {index < slides.length - 1 && (
              <label for={slideId(index + 1)} aria-hidden="true" mix={[arrowStyle, css({ right: '8px' })]}>
                ›
              </label>
            )}
          </div>
        ))}

        <div class="carousel-dots" mix={dotsStyle}>
          {slides.map((_, index) => (
            <label key={`dot-${index}`} for={slideId(index)} mix={dotStyle} aria-hidden="true" />
          ))}
        </div>
      </div>
    )
  }
}
