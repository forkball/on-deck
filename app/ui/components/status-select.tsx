import type { Handle } from 'remix/ui'

import { statusOptionsFor } from '../../utils/status.ts'
import { DEFAULT_MEDIA_TYPE, type ActiveMediaType } from '../../utils/mediaTypes.ts'

// A <select defaultValue={...}> doesn't actually preselect anything in this
// framework — real HTML needs `selected` set on the matching <option>. Set it
// explicitly per option instead of relying on a select-level default.
// `defaultValue` is a plain string (not InteractionStatus) because the
// data-table enum column type doesn't narrow on read, only on write.
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
