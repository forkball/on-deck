import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { renderToString } from 'remix/ui/server'

import {
  Button,
  ButtonLink,
  buttonFrameClass,
  CheckboxOption,
  ChoiceGroup,
  RadioOption,
  Select,
  Textarea,
  TextInput,
} from '../app/ui/shared/form-controls.tsx'

describe('form controls', () => {
  it('maps a button variant to the class app.css draws it with', async () => {
    assert.equal(await renderToString(<Button>Go</Button>), '<button type="button">Go</button>')
    assert.equal(
      await renderToString(<Button variant="link">Undo</Button>),
      '<button type="button" class="linkish">Undo</button>',
    )
    assert.equal(
      await renderToString(<Button variant="plain">Alien</Button>),
      '<button type="button" class="plain">Alien</button>',
    )
    assert.equal(
      await renderToString(
        <Button variant="checkline" ticked class="extra">
          x
        </Button>,
      ),
      '<button type="button" class="checkline ticked extra">x</button>',
    )
  })

  it('keeps an explicit button type and forwards native attributes', async () => {
    const html = await renderToString(
      <Button type="submit" variant="danger" name="choice" value="keep" disabled>
        Delete
      </Button>,
    )
    assert.match(html, /^<button /)
    for (const attribute of [
      'type="submit"',
      'class="danger"',
      'name="choice"',
      'value="keep"',
      'disabled',
    ]) {
      assert.ok(html.includes(attribute), `${attribute} in ${html}`)
    }
  })

  it('frames a link, or any other element, as a button', async () => {
    assert.equal(
      await renderToString(<ButtonLink href="/x">Log in</ButtonLink>),
      '<a href="/x" class="doodle-border">Log in</a>',
    )
    assert.equal(buttonFrameClass('primary'), 'doodle-border primary')
    assert.equal(buttonFrameClass('default', 'compact'), 'doodle-border compact')
  })

  it('fixes each input to its type', async () => {
    assert.match(await renderToString(<TextInput name="q" />), /type="text"/)
    assert.match(await renderToString(<TextInput type="password" name="p" />), /type="password"/)
    assert.match(await renderToString(<Textarea name="t" rows={3} />), /^<textarea[^>]*rows="3"/)
    assert.match(
      await renderToString(
        <Select name="s">
          <option value="">Any</option>
        </Select>,
      ),
      /^<select name="s"><option value="">Any<\/option><\/select>$/,
    )
  })
})

describe('choice options and groups', () => {
  it('labels the control, and passes every attribute to the input', async () => {
    const html = await renderToString(
      <RadioOption name="mode" value="self" defaultChecked disabled>
        Just me
      </RadioOption>,
    )
    assert.match(
      html,
      /^<div class="choice"><label class="choice-label"><input [^>]*><span class="choice-text">Just me<\/span><\/label><\/div>$/,
    )
    for (const attribute of ['type="radio"', 'name="mode"', 'value="self"', 'checked', 'disabled']) {
      assert.ok(html.includes(attribute), `${attribute} in ${html}`)
    }
    assert.match(await renderToString(<CheckboxOption name="c">Books</CheckboxOption>), /type="checkbox"/)
  })

  // Outside the <label>, so a disabled option's fade doesn't take the line that
  // says why it is disabled.
  it('puts a hint under the label, outside it', async () => {
    const html = await renderToString(
      <CheckboxOption name="is_private" hint="Only followers see your log.">
        Private profile
      </CheckboxOption>,
    )
    assert.match(html, /<\/label><div class="choice-hint">Only followers see your log\.<\/div><\/div>$/)
  })

  it('hides an option without unmounting it', async () => {
    const html = await renderToString(<CheckboxOption hidden>Sam</CheckboxOption>)
    // Attribute order is the renderer's business, so each is looked for on its own.
    assert.match(html, /^<div [^>]*\bhidden\b/)
    assert.match(html, /^<div [^>]*class="choice"/)
  })

  it('names its question with a legend', async () => {
    const html = await renderToString(
      <ChoiceGroup legend="Taste" legendSize="subsection" layout="row" hint="Changes which taste is read.">
        <CheckboxOption name="source">Movies</CheckboxOption>
      </ChoiceGroup>,
    )
    assert.match(
      html,
      /^<fieldset class="choice-group"><legend class="choice-legend subsection">Taste<\/legend><div class="choice-options row">/,
    )
    assert.match(html, /<div class="choice-group-hint">Changes which taste is read\.<\/div><\/fieldset>$/)
    // Defaults: a section-size legend over a column.
    assert.match(
      await renderToString(<ChoiceGroup legend="Who?" />),
      /choice-legend section.*choice-options column/,
    )
  })
})

// The point of the components is that there is one place to change how a control
// looks. That stops being true the first time a page writes a raw <button>, so
// this reads every .tsx under app/ and fails on one outside form-controls.tsx.
//
// What is allowed through: <input type="hidden">, which renders nothing, and the
// inputs below that are not form fields at all. Each is invisible and exists for
// its :checked state, which CSS reads to drive something else — so a CheckboxOption or
// RadioOption, which draws a visible, labelled control, would be the wrong thing.
const NOT_FORM_FIELDS: Array<{ file: string; marker: string; why: string }> = [
  { file: 'app/ui/components/tabs.tsx', marker: 'type="radio"', why: 'which tab is open' },
  { file: 'app/ui/components/image-carousel.tsx', marker: 'type="radio"', why: 'which slide is shown' },
  {
    file: 'app/ui/components/star-rating.tsx',
    marker: 'type="radio"',
    why: 'drawn as stars by their labels',
  },
  { file: 'app/ui/components/modal.tsx', marker: 'modal-toggle', why: 'whether the modal is open' },
  { file: 'app/ui/components/expandable-text.tsx', marker: 'type="checkbox"', why: '"more" / "less"' },
  { file: 'app/actions/profile/imports/review-page.tsx', marker: 'drawer-check', why: 'the review drawer' },
  {
    file: 'app/browser/letterboxd-import-form.tsx',
    marker: 'type="file"',
    why: 'hidden inside its drop zone',
  },
]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

// Comments blanked out, newlines kept so line numbers still point at the source.
// Prose about a control (`<select defaultValue>` doesn't preselect…) is not one.
// Only whole-line `//` comments, so a URL in a string is never mistaken for one;
// a trailing comment that names a tag fails this test loudly, never silently.
function withoutComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank)
}

// The opening tag, up to the `>` that closes it rather than one inside a `{…}`.
function openingTag(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

describe('raw form controls', () => {
  it('render only through app/ui/shared/form-controls.tsx', () => {
    const root = join(import.meta.dirname, '..')
    const found: string[] = []

    for (const path of tsxFiles(join(root, 'app'))) {
      const file = relative(root, path)
      if (file === 'app/ui/shared/form-controls.tsx') continue
      const source = withoutComments(readFileSync(path, 'utf8'))

      // Whitespace after the name skips a bare `<button>` in a string; every
      // real one here has attributes.
      for (const match of source.matchAll(/<(button|input|select|textarea)\s/g)) {
        const tag = openingTag(source, match.index)
        if (tag.includes('type="hidden"')) continue
        if (NOT_FORM_FIELDS.some((allowed) => allowed.file === file && tag.includes(allowed.marker))) continue
        const line = source.slice(0, match.index).split('\n').length
        found.push(`${file}:${line} <${match[1]}>`)
      }
    }

    assert.deepEqual(
      found,
      [],
      'use Button, TextInput, Select, Textarea, CheckboxOption or RadioOption instead',
    )
  })
})

// A control's look is the component's: its variants, in app.css. A call site
// owns where the control sits — width, flex, margins — and nothing else. Most of
// what a call site could say about the look is dead on arrival anyway: Doodle's
// button and field rules are unlayered and every css() rule is layered, so a
// `fontSize` or `padding` passed in is silently overridden. That is how the app
// came to have review-page buttons "at 13px" that rendered at 16, and suggestion
// rows "without a border" that were drawn framed. Where a different look is
// really wanted, it is a variant.
const LOOK_PROPERTIES = new Set([
  'background',
  'backgroundColor',
  'backgroundImage',
  'border',
  'borderColor',
  'borderImage',
  'borderRadius',
  'borderStyle',
  'borderWidth',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'boxShadow',
  'color',
  'cursor',
  'opacity',
  'outline',
  'font',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textDecoration',
  'textTransform',
  'height',
  'minHeight',
  'maxHeight',
  'padding',
  'paddingBlock',
  'paddingInline',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
])
const COMPONENTS =
  /<(Button|ButtonLink|TextInput|Select|Textarea|CheckboxOption|RadioOption|ChoiceGroup)[\s/>]/g

// The argument of each css(...) call in `text`, matched by brackets.
function cssArguments(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/\bcss\(/g)) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
    }
    found.push(text.slice(start, i - 1))
  }
  return found
}

// Every property name in a style object, nested selector blocks included. String
// values are blanked first so a colon inside one (a url, a time) isn't a key.
function styleKeys(style: string): string[] {
  const bare = style.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
  return [...bare.matchAll(/(?:^|[{,\s])([A-Za-z]\w*)\s*:/g)].map((match) => match[1])
}

describe('form control call sites', () => {
  it('set layout only, never the look', () => {
    const root = join(import.meta.dirname, '..')
    const found: string[] = []

    for (const path of tsxFiles(join(root, 'app'))) {
      const file = relative(root, path)
      if (file === 'app/ui/shared/form-controls.tsx') continue
      const source = withoutComments(readFileSync(path, 'utf8'))

      // A style kept in a constant (`const CTA_BUTTON = css({...})`) and passed
      // by name is the same thing as one written inline.
      const named = new Map<string, string>()
      for (const match of source.matchAll(/const\s+(\w+)\s*=\s*css\(/g)) {
        named.set(match[1], cssArguments(source.slice(match.index))[0] ?? '')
      }

      for (const match of source.matchAll(COMPONENTS)) {
        const tag = openingTag(source, match.index)
        const mix = tag.match(/\bmix=\{([\s\S]*)\}/)?.[1] ?? ''
        const styles = [
          ...cssArguments(mix),
          ...[...mix.matchAll(/\b([A-Z_][A-Z0-9_]*|[a-z]\w*)\b/g)].flatMap((m) =>
            named.has(m[1]) ? [named.get(m[1])!] : [],
          ),
        ]
        const look = [...new Set(styles.flatMap(styleKeys).filter((key) => LOOK_PROPERTIES.has(key)))]
        if (look.length > 0) {
          const line = source.slice(0, match.index).split('\n').length
          found.push(`${file}:${line} <${match[1]}> ${look.join(', ')}`)
        }
      }
    }

    assert.deepEqual(found, [], 'a control looks how its variant says; give it a variant rather than a style')
  })
})
