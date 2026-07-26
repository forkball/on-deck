import type { Handle } from 'remix/ui'
import { css, Fragment } from 'remix/ui'

const STAR_SIZE = 20

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

// Read-only star display — supports half-star values via a clipped overlay
// (outline star underneath, filled star on top clipped to 0/50/100% width).
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

const STEPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]

// A clickable half-star picker: 10 radios (0.5 steps) in descending DOM order,
// displayed reversed (row-reverse) so the ":checked ~ label" general sibling
// selector fills the current star plus every lower one. No JS required.
export function StarRatingInput(
  handle: Handle<{ name: string; defaultValue: number | null; idPrefix?: string }>,
) {
  return () => {
    const { name, defaultValue, idPrefix = name } = handle.props
    const half = STAR_SIZE / 2

    return (
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
    )
  }
}
