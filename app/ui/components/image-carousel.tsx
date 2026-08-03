import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// CSS-only, like the tabs and the log modal: a hidden radio per slide and
// `:has(…:checked)` sliding the track. Deliberately not anchor-based —
// `#slide-2` would push a history entry per image, so Back would step through
// them instead of leaving the page.
//
// Selectors key off `nth-of-type` rather than ids, so one static stylesheet
// serves any number of carousels.
const MAX_STILLS = 3

const carouselStyle = css({
  position: 'relative',
  // Clips the slides that are translated out of view.
  overflow: 'hidden',
  borderRadius: '8px',
  // Written out rather than generated — MAX_STILLS is small and fixed.
  '&:has(input:nth-of-type(1):checked) > .carousel-track': { transform: 'translateX(0%)' },
  '&:has(input:nth-of-type(2):checked) > .carousel-track': { transform: 'translateX(-100%)' },
  '&:has(input:nth-of-type(3):checked) > .carousel-track': { transform: 'translateX(-200%)' },
  // The dot for the current slide, and the arrows that would leave the strip.
  '&:has(input:nth-of-type(1):checked) .carousel-dots > label:nth-of-type(1)': { background: '#3c3c3c' },
  '&:has(input:nth-of-type(2):checked) .carousel-dots > label:nth-of-type(2)': { background: '#3c3c3c' },
  '&:has(input:nth-of-type(3):checked) .carousel-dots > label:nth-of-type(3)': { background: '#3c3c3c' },
  // Only the current slide's arrows show, so each points at a fixed neighbour.
  '& .carousel-nav': { display: 'none' },
  '&:has(input:nth-of-type(1):checked) .carousel-nav-0': { display: 'block' },
  '&:has(input:nth-of-type(2):checked) .carousel-nav-1': { display: 'block' },
  '&:has(input:nth-of-type(3):checked) .carousel-nav-2': { display: 'block' },
})

// Sits over the track without swallowing clicks. Matched to the track, not the
// whole component: `inset: 0` covered the dots too, leaving arrows centred
// below the middle of the image.
const navStyle = css({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  aspectRatio: '16 / 9',
  pointerEvents: 'none',
})

// Hidden but focusable, so arrow keys move through slides as in any radio group.
//
// Hidden via opacity and pointer-events rather than size: DoodleCSS gives
// `.doodle input[type=radio]` a 16px border-image from outside any @layer, so
// the element is really ~33px however small this says it is — an invisible
// click target over the image that would quietly change slides.
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
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

const slideStyle = css({
  flex: '0 0 100%',
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  background: '#eee',
  // No border-radius — DoodleCSS styles `.doodle img` unlayered, so it would be
  // dead code. Slides keep the same hand-drawn frame as every other image.
})

const dotsStyle = css({
  display: 'flex',
  justifyContent: 'center',
  gap: '8px',
  marginTop: '8px',
})

// No `display` — DoodleCSS forces `.doodle label` to inline-block unlayered, so
// it would be silently discarded. This has caught the project four times.
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
  // Centred on its own height, so padding and font size can change freely.
  top: '50%',
  transform: 'translateY(-50%)',
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
  // Unique per carousel — the radios need their own name and the dots need ids.
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
              // The first stands in for the set; enumerating the rest helps
              // a screen reader none.
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
