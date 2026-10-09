import type { Handle, Props, RemixNode } from 'remix/ui'

// The app's form controls. Every button, text input, select, textarea, checkbox
// and radio a person can see renders through one of these — checkboxes and
// radios as a labelled CheckboxOption or RadioOption, usually in a ChoiceGroup — so the look lives in
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
  // The hand-drawn frame. The default; `secondary` is what app.css turns
  // blue on hover, so a new variant never picks that up by accident.
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
  // A full-width row in a menu or a list of results: a FloatingDropdown, the
  // profile menu, search suggestions. Borderless, left-aligned, tinted on hover.
  | 'menu-choice'
  // A button in a menu of links, drawn as one of them: the profile menu's Log out,
  // which has to POST but sits under Media, People, Settings. The links take the
  // same `menu-link` class, so all of them share one look.
  | 'menu-link'
  // No frame, padding or background: a button whose look is its content — the
  // poster tiles in the import picker. Layout is the call site's.
  | 'plain'

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: 'secondary',
  primary: 'primary',
  danger: 'danger',
  link: 'linkish',
  bare: 'bare',
  checkline: 'checkline',
  'menu-choice': 'menu-choice',
  'menu-link': 'menu-link',
  plain: 'plain',
}

function joinClasses(...classes: Array<string | false | null | undefined>): string | undefined {
  const joined = classes.filter(Boolean).join(' ')
  return joined === '' ? undefined : joined
}

type ButtonProps = Props<'button'> & {
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

// A link that looks like a button: navigation, styled as an action.
export function ButtonLink(handle: Handle<Props<'a'>>) {
  return () => {
    const { class: className, ...rest } = handle.props
    return <a {...rest} class={buttonFrameClass('default', className)} />
  }
}

export type LinkVariant =
  // A link in running text: the accent, bold. The default; no class.
  | 'default'
  // The default at a smaller size, for a link that sits beside a heading as
  // its secondary action ("Import from Letterboxd" by "What I've watched").
  | 'small'
  // The small underlined sentence Button's `link` variant is, as a real link:
  // the review's "jump to" under a duplicate. Same `linkish` class, same look.
  | 'subtle'
  // A link around something with a look of its own — a poster, a bell icon, a
  // whole row. Takes its colour and weight from what it wraps, no underline.
  | 'wrap'
  // The site's wordmark in the nav, drawn as a ticket stub.
  | 'brand'
  // A row in a menu of places to go: the profile menu. Shares `menu-link`
  // with Button's menu-link variant, so the links and Log out are one look.
  | 'menu'
  // A media-type tab that fetches its page (MediaTabLinks). Quiet until it is
  // the current one, which `aria-current` marks.
  | 'tab'

const LINK_CLASS: Record<LinkVariant, string | undefined> = {
  default: undefined,
  small: 'small-link',
  subtle: 'linkish',
  wrap: 'wrap-link',
  brand: 'brand',
  menu: 'menu-link',
  tab: 'media-tab',
}

type LinkProps = Props<'a'> & {
  variant?: LinkVariant
  // Opens in a new tab, without handing that tab a handle back to this one.
  external?: boolean
  // The invisible touch target app.css draws around small links on a phone.
  tapArea?: boolean
}

// Every link in the app. Their look lives in public/app.css, for the reason
// the buttons' does: DoodleCSS's `.doodle a { color; font-weight: bold }` is
// unlayered, so a css() colour or weight at the call site is dropped without a
// word — which is how links ended up carrying `fontWeight: 700` that did
// nothing. A call site's `mix` is for layout.
export function Link(handle: Handle<LinkProps>) {
  return () => {
    const { variant = 'default', external, tapArea, class: className, ...rest } = handle.props
    return (
      <a
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...rest}
        class={joinClasses(LINK_CLASS[variant], tapArea && 'tap-area', className)}
      />
    )
  }
}

type ToggleLabelProps = Props<'label'> & {
  // The id of the invisible checkbox this opens or closes.
  for: string
  // `link`: the small underlined sentence, like Button's `link`. `button` and
  // `primary`: drawn as that button, on a span, since DoodleCSS pads a <label>
  // and the frame has to sit on the element without the padding. `plain`: no
  // look of its own, for a toggle whose content is the look (the review drawer).
  variant?: 'link' | 'button' | 'primary' | 'plain'
  // The invisible touch target app.css draws around small controls on a phone.
  tapArea?: boolean
  // `button` or `primary` holding only an icon: the square frame FloatingDropdown's
  // icon trigger has. The label then needs an aria-label to have a name.
  icon?: boolean
}

// A <label> that works a CSS-only toggle — opens a Modal, the import review's
// drawer — rather than naming a field. Field and the choice options own the
// labels that name things; this is the other kind, so it gets a look from the
// same place as a button rather than one written at each call site.
export function ToggleLabel(handle: Handle<ToggleLabelProps>) {
  return () => {
    const { variant = 'plain', tapArea, icon, children, class: className, ...rest } = handle.props
    if (variant === 'button' || variant === 'primary') {
      return (
        <label
          {...rest}
          class={joinClasses('modal-trigger', 'toggle-label', tapArea && 'tap-area', className)}
        >
          <span
            class={buttonFrameClass(variant === 'primary' ? 'primary' : 'default', icon ? 'icon' : undefined)}
          >
            {children}
          </span>
        </label>
      )
    }
    return (
      <label
        {...rest}
        class={joinClasses('toggle-label', variant === 'link' && 'linkish', tapArea && 'tap-area', className)}
      >
        {children}
      </label>
    )
  }
}

// <input>'s props are a union keyed on `type`, each arm with the roles that
// type may take. A component that fixes the type takes the attributes common to
// all of them (`role` aside, which none of these call for) and restores the
// arm's shape with one cast at the element.
type InputAttributes = Omit<Props<'input'>, 'type' | 'role'>

type TextInputProps = InputAttributes & {
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

// A checkbox or radio with its label, and optionally a line under it. There is
// no bare Checkbox or Radio to reach for instead: an unlabelled one is never
// what a page wants, and every page that laid its own label beside one did it a
// little differently — three ways, before these.
//
// `children` is the label: text, plus anything that belongs on its line (a
// "runs left" pill, a "(soon)"). `hint` sits under the label, lined up with the
// label's text rather than the control, and outside the <label> so it stays
// readable when the option is disabled and the label fades — it is often the
// line saying why. Every other attribute reaches the <input>, `mix` included.
//
// The layout is in app.css (`.choice`): DoodleCSS sets `.doodle label {
// display: inline-block; padding }` unlayered, which no css() rule can beat.
// `hidden` goes on the wrapper, which nothing sets a display on, so the
// browser's own [hidden] rule holds: the friend picker hides an option a
// search filters out without unmounting it, keeping its ticked state.
type ChoiceOptionProps = InputAttributes & {
  hint?: RemixNode
  hidden?: boolean
}

// The markup both share, called rather than rendered: one component per option,
// which the friend picker re-renders a whole list of on every keystroke.
function renderChoice(type: 'checkbox' | 'radio', props: ChoiceOptionProps): RemixNode {
  const { children, hint, hidden, ...input } = props
  return (
    <div class="choice" hidden={hidden}>
      <label class="choice-label">
        <input {...({ ...input, type } as Props<'input'>)} />
        <span class="choice-text">{children}</span>
      </label>
      {hint != null && hint !== false && <div class="choice-hint">{hint}</div>}
    </div>
  )
}

export function CheckboxOption(handle: Handle<ChoiceOptionProps>) {
  return () => renderChoice('checkbox', handle.props)
}

export function RadioOption(handle: Handle<ChoiceOptionProps>) {
  return () => renderChoice('radio', handle.props)
}

// A set of options that answer one question: a <fieldset> whose <legend> is the
// question, so a screen reader names it before reading the choices. The legend
// comes in the form's two heading sizes — `section` is the small capitals of
// "What are you after?", `subsection` the bold "Taste" inside Settings.
//
// `hint` is a line for the group as a whole, under the options. `layout` is
// how they sit: a column, or a row that wraps.
type ChoiceGroupProps = {
  legend: RemixNode
  legendSize?: 'section' | 'subsection'
  layout?: 'column' | 'row'
  hint?: RemixNode
  children?: RemixNode
  mix?: Props<'fieldset'>['mix']
}

export function ChoiceGroup(handle: Handle<ChoiceGroupProps>) {
  return () => {
    const { legend, legendSize = 'section', layout = 'column', hint, children, mix } = handle.props
    return (
      <fieldset class="choice-group" mix={mix}>
        <legend class={`choice-legend ${legendSize}`}>{legend}</legend>
        <div class={`choice-options ${layout}`}>{children}</div>
        {hint != null && hint !== false && <div class="choice-group-hint">{hint}</div>}
      </fieldset>
    )
  }
}
