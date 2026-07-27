import { css } from 'remix/ui'

// Stacks a <label>'s text above its input/select/textarea. DoodleCSS sets
// `.doodle label { display: inline-block }`, which outranks a bare generated
// class on specificity (class+element vs. class alone) and wins regardless of
// source order — so `display: flex` on the label itself gets silently
// overridden. Target the field directly instead: a block-level child always
// starts on its own line after preceding text, no matter what the label's own
// display is.
export const stackedLabel = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  '& select, & input, & textarea': {
    display: 'block',
    width: '100%',
  },
})
