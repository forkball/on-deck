import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// A horizontally scrollable strip of stills.
//
// No JavaScript and no URL state, which rules out the two obvious
// alternatives. Anchor-based slides (`#slide-2`) push history entries, the
// same reason the log modal was moved off `:target` — pressing back would
// walk through the images instead of leaving the page. Radio buttons plus a
// transformed track keep the URL clean but replace native scrolling, which
// costs touch swipe entirely.
//
// Scroll snapping keeps the browser's own behaviour: swipe on touch,
// shift-scroll or trackpad on desktop, arrow keys once focused, and it
// degrades to a plain scrolling row anywhere `scroll-snap-type` is missing.
const trackStyle = css({
  display: 'flex',
  gap: '8px',
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  borderRadius: '8px',
  // Room for the scrollbar so it never sits on top of an image.
  paddingBottom: '8px',
})

const slideStyle = css({
  scrollSnapAlign: 'center',
  // Slightly narrower than the track, so the next image peeks in and the
  // strip reads as scrollable without a caption saying so.
  flex: '0 0 92%',
  // No border-radius here: DoodleCSS sets `.doodle img { border-radius: 3px }`
  // plus its sketched border-image outside any @layer, and unlayered wins over
  // anything layered regardless of specificity. Slides get the same hand-drawn
  // frame as every other image in the app, which is the intent anyway — a
  // radius declared here would just be dead code.
  //
  // 16:9 stills vary by a few pixels between titles; fixing the ratio keeps
  // the strip from jolting as you scroll.
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  background: '#eee',
})

// IGDB returns whatever a game happens to have — 5 is typical, some carry 20
// — and showing all of them turned the strip into a long scroll for no gain.
// Three is enough to convey what a game looks like.
//
// Capped at display rather than on the way in: the full set arrives free with
// the search response, costs about 76 kB across the whole catalog, and
// keeping it means changing this number never needs a re-fetch or a backfill.
const MAX_STILLS = 3

export interface ImageCarouselProps {
  images: string[]
  title: string
}

export function ImageCarousel(handle: Handle<ImageCarouselProps>) {
  return () => {
    const { images, title } = handle.props

    return (
      <div mix={trackStyle}>
        {images.slice(0, MAX_STILLS).map((image, index) => (
          <img
            key={image}
            src={image}
            // The first is the key art; the rest are decorative stills that
            // a screen reader gains nothing from enumerating.
            alt={index === 0 ? `${title} artwork` : ''}
            // Only the opening image is worth blocking render on.
            loading={index === 0 ? 'eager' : 'lazy'}
            mix={slideStyle}
          />
        ))}
      </div>
    )
  }
}
