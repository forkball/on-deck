import { routes } from '../../routes.ts'
import { hintStyle } from '../shared/field.tsx'

// The line under every note field, saying that what gets typed there is read
// when a taste profile is written. It lives in ui/components rather than beside
// one of the three surfaces that logs a note because none of them owns it — see
// AGENTS.md — and it reaches `routes`, which ui/shared may not.
//
// Rendered as a sibling of the field rather than through Field's `hint`: that
// slot is inside the <label>, and a <label> may hold no interactive content
// besides its own control, so an <a> there is invalid and clicking it would
// also focus the textarea.
//
// Deliberately not conditional on the reader's own `profile_use_notes`: making
// it so would thread that flag through every surface that logs a note, and the
// wording is true whether notes are on or off. The bio field carries the
// opposite hint — see profile/edit — and until now the field that does reach a
// model was the one saying nothing.
export function NotesHint() {
  return () => (
    <p mix={hintStyle}>
      Feeds your taste profile unless you've turned notes off in{' '}
      <a href={routes.profile.edit.index.href()}>settings</a>.
    </p>
  )
}
