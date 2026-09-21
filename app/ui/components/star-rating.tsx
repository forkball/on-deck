import type { Handle } from 'remix/ui'
import { css, Fragment } from 'remix/ui'

import { StarRatingClearer } from '../../browser/star-rating-clearer.tsx'
import { DISLIKED_INPUT_VALUE } from '../../data/mediaItems.ts'

const STAR_SIZE = 24

function StarIcon(handle: Handle<{ variant: 'outline' | 'filled' }>) {
  return () => {
    const { variant } = handle.props
    const d =
      'M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 19.771l-7.416 3.642 1.48-8.279L.001 9.306l8.332-1.151z'
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
              mix={css({
                position: 'relative',
                display: 'inline-block',
                width: `${STAR_SIZE}px`,
                height: `${STAR_SIZE}px`,
              })}
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

// Words rather than an empty star row: a dislike is the absence of a score, and
// five empty stars would read as "rated it zero".
export function DislikedDisplay() {
  return () => (
    <span mix={css({ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' })}>
      Not for me
    </span>
  )
}

const STEPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]

// The opt-out, styled as a chip. Its radio is hidden outright rather than left at
// DoodleCSS's `opacity: 0`, so the label carries the state rather than an
// invisible control beside it.
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
  // Padding lives in `.doodle label.rating-choice` in app.css, not here: these
  // css() rules are layered and DoodleCSS is not, so its `label { padding }` wins
  // at any specificity and padding set here is silently dropped.
  '& label': {
    display: 'inline-block',
    borderRadius: '999px',
    border: '1px solid #ccc',
    color: '#666',
    cursor: 'pointer',
    // Off the same constant as the stars it sits beside, so the two can't drift.
    // `box-sizing: border-box` makes this the outer height, and line-height less
    // the 1px borders centres the text — padding would lose to DoodleCSS here.
    height: `${STAR_SIZE}px`,
    lineHeight: `${STAR_SIZE - 2}px`,
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

// One question with three kinds of answer in a single radio group: a score, no
// score, or a dislike. parseRatingSubmission unpacks the one submitted value
// into the two columns that store it.
//
// 10 radios in descending DOM order, displayed row-reverse so `:checked ~ label`
// fills the current star plus every lower one. No JS.
//
// The opt-out sits outside the star strip: it is a refusal to score, not the
// bottom of the scale, and in line with the stars it would read as the low number
// it isn't. Unrated has no control at all — it is simply no star selected, which
// is where clicking the current selection lands you (StarRatingClearer).
//
// The label carries the styling because DoodleCSS computes the radios themselves
// to `opacity: 0`, so a bare one renders as nothing.
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
