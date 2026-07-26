import { css } from 'remix/ui'

// Stacks a <label>'s text above its input/select/textarea instead of the
// browser default of laying them out side by side inline.
export const stackedLabel = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
})
