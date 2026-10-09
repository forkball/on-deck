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
  Link,
  RadioOption,
  Select,
  Textarea,
  TextInput,
  ToggleLabel,
} from '../app/ui/shared/form-controls.tsx'
import { Field } from '../app/ui/shared/field.tsx'

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
      await renderToString(<Button variant="menu-link">Log out</Button>),
      '<button type="button" class="menu-link">Log out</button>',
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

  it('maps a link variant to its class, and opens an external one in a new tab', async () => {
    assert.equal(await renderToString(<Link href="/x">Log</Link>), '<a href="/x">Log</a>')
    assert.equal(
      await renderToString(
        <Link href="/x" variant="wrap" tapArea>
          x
        </Link>,
      ),
      '<a href="/x" class="wrap-link tap-area">x</a>',
    )
    const external = await renderToString(
      <Link href="https://example.com" external>
        TMDB
      </Link>,
    )
    for (const attribute of ['target="_blank"', 'rel="noopener noreferrer"']) {
      assert.ok(external.includes(attribute), `${attribute} in ${external}`)
    }
  })

  it('draws a toggle label as a link or on a button frame', async () => {
    assert.equal(
      await renderToString(
        <ToggleLabel for="t" variant="link">
          Go back
        </ToggleLabel>,
      ),
      '<label for="t" class="toggle-label linkish">Go back</label>',
    )
    assert.equal(
      await renderToString(
        <ToggleLabel for="t" variant="primary">
          Save
        </ToggleLabel>,
      ),
      '<label for="t" class="modal-trigger toggle-label"><span class="doodle-border primary">Save</span></label>',
    )
  })

  it('keeps a hidden field label for screen readers', async () => {
    const html = await renderToString(
      <Field label="Search people" labelHidden>
        <TextInput name="q" />
      </Field>,
    )
    assert.match(html, /<span class="visually-hidden[^"]*"[^>]*>Search people<\/span>/)
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

// Links and labels, likewise: every <a> goes through Link, and every <label>
// through Field, a choice option or ToggleLabel. These components own a
// <label> of their own as part of how they work — the tab strip, a modal's
// trigger, the stars — and the drop zone wraps its hidden file input in one.
const OWNS_LABELS = new Set([
  'app/ui/shared/field.tsx',
  'app/ui/components/modal.tsx',
  'app/ui/components/tabs.tsx',
  'app/ui/components/image-carousel.tsx',
  'app/ui/components/star-rating.tsx',
  'app/ui/components/expandable-text.tsx',
  'app/browser/letterboxd-import-form.tsx',
])

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

      // `<a` then whitespace or `>`, so `<abbr>` and `<area>` don't match.
      for (const match of source.matchAll(/<(a|label)[\s>]/g)) {
        if (match[1] === 'label' && OWNS_LABELS.has(file)) continue
        const line = source.slice(0, match.index).split('\n').length
        found.push(`${file}:${line} <${match[1]}>`)
      }
    }

    assert.deepEqual(
      found,
      [],
      'use Button, Link, TextInput, Select, Textarea, Field, CheckboxOption, RadioOption or ToggleLabel instead',
    )
  })
})
