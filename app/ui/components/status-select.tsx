import type { Handle } from 'remix/ui'

import { DEFAULT_MEDIA_TYPE, statusOptionsFor, type ActiveMediaType } from '../../mediaTypes.ts'

// `<select defaultValue>` doesn't preselect in this framework — HTML needs
// `selected` on the matching <option>. `defaultValue` is a plain string because
// the data-table enum column doesn't narrow on read, only on write.
export function StatusSelect(
  handle: Handle<{ name: string; defaultValue: string; mediaType?: ActiveMediaType }>,
) {
  return () => {
    const { name, defaultValue, mediaType } = handle.props
    const options = statusOptionsFor(mediaType ?? DEFAULT_MEDIA_TYPE)

    return (
      <select name={name}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} selected={opt.value === defaultValue}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }
}
