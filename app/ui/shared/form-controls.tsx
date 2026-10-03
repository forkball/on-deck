import type { Handle, Props } from 'remix/ui'

// The app's form controls. Every button, text input, select, textarea, checkbox
// and radio a person can see renders through one of these, so the look lives in
// one place rather than as a class string retyped at each call site —
// test/form-controls.test.ts fails on a raw control anywhere else.
//
// Rendered on both sides — the generate and search forms are client entries —
// so this lives in app/ui/shared and imports nothing but remix/ui.
//
// The look itself is in public/app.css, not here: DoodleCSS styles these
// elements from outside any @layer, and a css() rule is layered, so it would
// lose to Doodle at any specificity. What these components own is which of
// those rules applies — the variant names, and the classes they map to.
//
// Each forwards every native attribute it is given, `mix` included, so a call
// site's layout styles and event handlers reach the element unchanged.

export type ButtonVariant =
  // The hand-drawn frame. The default; no class.
  | 'default'
  // Dark frame at rest: the one action a form exists for.
  | 'primary'
  // Destructive (delete log). Red text in the default frame.
  | 'danger'
  // Reads as an underlined sentence rather than a control.
  | 'link'
  // Text or an icon with no frame — a close ×, a remove-file button.
  | 'bare'
  // A submit drawn as a checkbox, with `ticked` for its state. Its box is a
  // `.checkline-box` span among the children; `radio` on that span for a radio.
  | 'checkline'
  // A full-width row in a FloatingDropdown menu.
  | 'menu-choice'

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: 'primary',
  danger: 'danger',
  link: 'linkish',
  bare: 'bare',
  checkline: 'checkline',
  'menu-choice': 'menu-choice',
}

function joinClasses(...classes: Array<string | false | null | undefined>): string | undefined {
  const joined = classes.filter(Boolean).join(' ')
  return joined === '' ? undefined : joined
}

export type ButtonProps = Props<'button'> & {
  variant?: ButtonVariant
  // Only meaningful on `checkline`: the box shows as ticked.
  ticked?: boolean
}

export function Button(handle: Handle<ButtonProps>) {
  return () => {
    const { variant = 'default', ticked, class: className, type, ...rest } = handle.props

    return (
      <button
        {...rest}
        // A <button> with no type submits its form, which is never what a
        // missing attribute was meant to say.
        type={type ?? 'button'}
        class={joinClasses(VARIANT_CLASS[variant], ticked && 'ticked', className)}
      />
    )
  }
}

// The button frame for an element that has to be something other than a
// <button> — a modal trigger is a <span> inside its <label>, a dropdown's
// trigger is a <summary>. ButtonLink below is the <a> case. `.doodle-border`
// is what app.css draws the frame on for those, and keeps every rule a real
// button gets, hover and focus included.
export function buttonFrameClass(variant: 'default' | 'primary' = 'default', extra?: string): string {
  return joinClasses('doodle-border', variant === 'primary' && 'primary', extra)!
}

export type ButtonLinkProps = Props<'a'> & { variant?: 'default' | 'primary' }

// A link that looks like a button: navigation, styled as an action.
export function ButtonLink(handle: Handle<ButtonLinkProps>) {
  return () => {
    const { variant, class: className, ...rest } = handle.props
    return <a {...rest} class={buttonFrameClass(variant, className)} />
  }
}

// <input>'s props are a union keyed on `type`, each arm with the roles that
// type may take. A component that fixes the type takes the attributes common to
// all of them (`role` aside, which none of these call for) and restores the
// arm's shape with one cast at the element.
type InputAttributes = Omit<Props<'input'>, 'type' | 'role'>

export type TextInputProps = InputAttributes & {
  type?: 'text' | 'email' | 'password' | 'search'
}

export function TextInput(handle: Handle<TextInputProps>) {
  return () => {
    const { type, ...rest } = handle.props
    return <input {...({ ...rest, type: type ?? 'text' } as Props<'input'>)} />
  }
}

// `defaultValue` doesn't preselect a <select> in this framework — HTML needs
// `selected` on the matching <option>, so a call site that cares sets that on
// its options (see StatusSelect). Left to the options rather than taken as a
// prop here, since half the selects build their options from a table and the
// other half write them out.
export function Select(handle: Handle<Props<'select'>>) {
  return () => <select {...handle.props} />
}

export function Textarea(handle: Handle<Props<'textarea'>>) {
  return () => <textarea {...handle.props} />
}

export function Checkbox(handle: Handle<InputAttributes>) {
  return () => <input {...({ ...handle.props, type: 'checkbox' } as Props<'input'>)} />
}

export function Radio(handle: Handle<InputAttributes>) {
  return () => <input {...({ ...handle.props, type: 'radio' } as Props<'input'>)} />
}
