import type { Handle } from 'remix/ui'

import { routes } from '../../routes.ts'
import { Field, hintStyle } from '../shared/field.tsx'

// The note field, wherever something is logged — four places now, which is why
// the control and the line under it live together rather than being spelled out
// at each one. It sits in ui/components because none of those four owns it (see
// AGENTS.md) and it reaches `routes`, which ui/shared may not.
//
// The hint is a sibling of Field rather than its `hint` prop: that slot renders
// inside the <label>, and a <label> may hold no interactive content besides its
// own control, so the link would be invalid there and clicking it would also
// focus the textarea. The wrapper is what keeps that structural choice from
// showing — every caller stacks these fields in a flex column with a gap, and
// without it the gap would land between the field and its own description
// instead of above the pair.
//
// Deliberately not conditional on the reader's own `profile_use_notes`: making
// it so would thread that flag through all four surfaces, and the wording is
// true whether notes are on or off. The bio field carries the opposite hint —
// see profile/edit — and until now the field that does reach a model was the one
// saying nothing.
export function NotesField(handle: Handle<{ defaultValue?: string | null }>) {
  return () => (
    <div>
      <Field label="Notes">
        <textarea
          name="notes"
          rows={3}
          defaultValue={handle.props.defaultValue ?? ''}
          placeholder="What did you think?"
        />
      </Field>
      <p mix={hintStyle}>
        Feeds your taste profile unless you've turned notes off in{' '}
        <a href={routes.profile.edit.index.href()}>settings</a>.
      </p>
    </div>
  )
}
