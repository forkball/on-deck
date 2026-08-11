import type { Handle } from 'remix/ui'
import { css, Fragment } from 'remix/ui'

import { StarRatingClearer } from '../../browser/star-rating-clearer.tsx'
import { DISLIKED_INPUT_VALUE } from '../../data/mediaItems.ts'

const STAR_SIZE = 24

function StarIcon(handle: Handle<{ variant: 'outline' | 'filled' }>) {
  return () => {
    const { variant } = handle.props
    const d = 'M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 19.771l-7.416 3.642 1.48-8.279L.001 9.306l8.332-1.151z'
    return (
      <svg viewBox="0 0 24 24" width={STAR_SIZE} height={STAR_SIZE} mix={css({ display: 'block' })}>
        <path
          d={d}
          fill={variant === 'filled' ? '#f5b301' : 'none'}
          stroke="#3c3c3c"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
    )
  }
}

// Half-stars via a clipped overlay: outline underneath, filled on top clipped
// to 0/50/100% width.
export function StarRatingDisplay(handle: Handle<{ value: number }>) {
  return () => {
    const { value } = handle.props

    return (
      <span mix={css({ display: 'inline-flex', gap: '2px', verticalAlign: 'middle' })}>
        {[1, 2, 3, 4, 5].map((i) => {
          const remainder = value - (i - 1)
          const fillWidth = remainder >= 1 ? '100%' : remainder >= 0.5 ? '50%' : '0%'

          return (
            <span
              key={i}
              mix={css({ position: 'relative', display: 'inline-block', width: `${STAR_SIZE}px`, height: `${STAR_SIZE}px` })}
            >
              <span mix={css({ position: 'absolute', inset: 0 })}>
                <StarIcon variant="outline" />
              </span>
              <span mix={css({ position: 'absolute', inset: 0, overflow: 'hidden', width: fillWidth })}>
                <StarIcon variant="filled" />
              </span>
            </span>
          )
        })}
      </span>
    )
  }
}

// The read-only counterpart to picking "Didn't like it". Deliberately words
// rather than an empty star row: a dislike is the absence of a score, and
// drawing it as five empty stars would say "rated it zero", which is the exact
// confusion the scale is built to avoid.
export function DislikedDisplay() {
  return () => (
    <span mix={css({ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' })}>
      Not for me
    </span>
  )
}

const STEPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]

// The opt-out, styled as a chip. Its radio is hidden outright rather than left
// to render at DoodleCSS's `opacity: 0`, so the state is something the label
// shows instead of something invisible next to it: an outline when idle, filled
// and dark when chosen.
const CHOICE_GROUP = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '13px',
  '& input': {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
  // Padding is deliberately absent here — see `.doodle label.rating-choice` in
  // app.css. These css() rules are layered and DoodleCSS is not, so its
  // `.doodle label { padding: .25em 0 }` wins whatever specificity is thrown at
  // it from here: padding set in this block is silently dropped and the pill
  // closes to within a pixel of the text. Everything else in here is
  // uncontested, which is why only padding had to move.
  '& label': {
    display: 'inline-block',
    borderRadius: '999px',
    border: '1px solid #ccc',
    color: '#666',
    cursor: 'pointer',
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
  },
  '& label:hover': {
    borderColor: '#999',
    color: '#3c3c3c',
  },
  '& input:checked + label': {
    borderColor: '#3c3c3c',
    backgroundColor: '#3c3c3c',
    color: '#fdf9f0',
  },
} as const

// One question with three kinds of answer, in one radio group: a score, no
// score, or a dislike. They are mutually exclusive because they are answers to
// the same question — "how did this land" — and a row claiming four stars and
// a dislike at once would be nonsense. `parseRatingSubmission` unpacks the
// single submitted value into the two columns that store it.
//
// 10 radios in descending DOM order, displayed row-reverse so `:checked ~ label`
// fills the current star plus every lower one. No JS.
//
// The opt-out sits outside the star strip rather than becoming a step on the
// left of it. It is not the bottom of the scale — it is a refusal to score —
// and rendering it in line with the stars would read as exactly the low number
// it isn't. The "or" between them says the same thing in words, and the three
// stay grouped together: pushed to opposite ends of the row they stop reading
// as one choice, which is the only thing holding them together.
//
// Unrated has no control of its own: it is simply no star selected, which is
// also where clicking the current selection lands you. That is what
// StarRatingClearer is for, and it is the one part of this that needs a script.
//
// The label carries the styling because the radios themselves are invisible:
// DoodleCSS lays them out at 1.5em but they compute to `opacity: 0`, so a bare
// radio renders as nothing at all and reads as plain text.
export function StarRatingInput(
  handle: Handle<{ name: string; defaultValue: number | null; idPrefix?: string; disliked?: boolean | null }>,
) {
  return () => {
    const { name, defaultValue, idPrefix = name, disliked = null } = handle.props
    const half = STAR_SIZE / 2
    const dislikedId = `${idPrefix}-disliked`

    // A dislike and a score are mutually exclusive, so a disliked row has no
    // star selected.
    const isDisliked = disliked === true

    return (
      <span
        class="rating-group"
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        })}
      >
        <span
          mix={css({
            display: 'inline-flex',
            flexDirection: 'row-reverse',
            verticalAlign: 'middle',
            '& input': {
              position: 'absolute',
              width: 0,
              height: 0,
              opacity: 0,
              pointerEvents: 'none',
            },
            '& label': {
              display: 'inline-block',
              width: `${half}px`,
              height: `${STAR_SIZE}px`,
              overflow: 'hidden',
              cursor: 'pointer',
              backgroundImage: 'url(/vendor/stars/star-outline.svg)',
              backgroundSize: `${STAR_SIZE}px ${STAR_SIZE}px`,
              backgroundRepeat: 'no-repeat',
            },
            '& input:checked ~ label, & input:checked + label': {
              backgroundImage: 'url(/vendor/stars/star-filled.svg)',
            },
          })}
        >
          {STEPS.map((step) => {
            const isRightHalf = Number.isInteger(step)
            const id = `${idPrefix}-${String(step).replace('.', '_')}`
            return (
              <Fragment key={step}>
                <input type="radio" id={id} name={name} value={step} defaultChecked={defaultValue === step} />
                <label
                  for={id}
                  title={String(step)}
                  mix={css({ backgroundPosition: isRightHalf ? `-${half}px 0` : '0 0' })}
                />
              </Fragment>
            )
          })}
        </span>

        <span mix={css({ fontSize: '13px', color: '#888' })}>or</span>

        {/* Same radio group as the stars, so picking this deselects them. It
            sits outside the strip above, whose `input:checked ~ label` fill
            rules would otherwise treat it as a step. */}
        <span mix={css({ ...CHOICE_GROUP })}>
          <input
            type="radio"
            id={dislikedId}
            name={name}
            value={DISLIKED_INPUT_VALUE}
            defaultChecked={isDisliked}
          />
          <label for={dislikedId} class="rating-choice">
            Not for me
          </label>
        </span>

        {/* Nothing selected submits no `rating` field at all, which the log
            actions default to '' and read as unrated — so clearing needs no
            control of its own, only this. */}
        <StarRatingClearer />
      </span>
    )
  }
}
