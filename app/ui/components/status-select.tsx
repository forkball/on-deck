import type { Handle } from 'remix/ui'

import { STATUS_OPTIONS } from '../../utils/status.ts'

// A <select defaultValue={...}> doesn't actually preselect anything in this
// framework — real HTML needs `selected` set on the matching <option>. Set it
// explicitly per option instead of relying on a select-level default.
// `defaultValue` is a plain string (not InteractionStatus) because the
// data-table enum column type doesn't narrow on read, only on write.
export function StatusSelect(handle: Handle<{ name: string; defaultValue: string }>) {
  return () => {
    const { name, defaultValue } = handle.props

    return (
      <select name={name}>
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} selected={opt.value === defaultValue}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }
}
