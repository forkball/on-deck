import type { Handle } from 'remix/ui'
import { css, Fragment } from 'remix/ui'

// The verdict, asked separately from the score. A rating answers "how good was
// it" and this answers "was it for me" — related, but not the same question,
// and the second one is the one people will actually give when they don't feel
// like grading something.
//
// Three radios rather than two, for the same reason the star picker has a "No
// rating" option: a radio can't be unchecked, so without an explicit way back
// to "haven't said" the first click here would be permanent. Null is the
// default and stays reachable.
const CHOICES: { value: string; label: string }[] = [
  { value: 'yes', label: 'Liked it' },
  { value: 'no', label: "Didn't like it" },
  { value: '', label: 'No opinion' },
]

export function LikedInput(
  handle: Handle<{ name: string; defaultValue: boolean | null; idPrefix?: string }>,
) {
  return () => {
    const { name, defaultValue, idPrefix = name } = handle.props
    // The stored value spelled the way the form spells it, so the comparison
    // below stays a plain string match in all three cases.
    const current = defaultValue === true ? 'yes' : defaultValue === false ? 'no' : ''

    return (
      <span mix={css({ display: 'inline-flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px' })}>
        {CHOICES.map((choice) => {
          const id = `${idPrefix}-${choice.value || 'none'}`
          return (
            <Fragment key={choice.value}>
              <span mix={css({ display: 'inline-flex', alignItems: 'center', gap: '6px' })}>
                <input
                  type="radio"
                  id={id}
                  name={name}
                  value={choice.value}
                  defaultChecked={current === choice.value}
                />
                <label for={id}>{choice.label}</label>
              </span>
            </Fragment>
          )
        })}
      </span>
    )
  }
}

// The read-only counterpart. Renders nothing when no verdict has been given —
// "hasn't said" is not a thing to announce on every row that lacks one.
export function LikedDisplay(handle: Handle<{ value: boolean | null }>) {
  return () => {
    const { value } = handle.props
    if (value == null) return null

    return (
      <span mix={css({ display: 'inline-flex', alignItems: 'center', gap: '4px' })}>
        {value ? 'Liked it' : "Didn't like it"}
      </span>
    )
  }
}
