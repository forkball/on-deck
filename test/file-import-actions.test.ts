import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Database } from 'remix/data-table'
import { Auth } from 'remix/middleware/auth'
import type { Handle, RemixNode } from 'remix/ui'

import {
  createFileImportActions,
  stagedBatchHref,
  type ImportPageProps,
  type ParsedUpload,
} from '../app/actions/profile/fileImportActions.tsx'
import type { AuthedControllerContext } from '../app/middleware/context.ts'
import type { ImportBatch, User } from '../app/data/schema.ts'

// The upload flow shared by import-books and import-movies. Both controllers
// are bindings over createFileImportActions, so a mistake here breaks two real
// imports at once and neither had any coverage before.
//
// No database: every branch asserted below stops before the staging write.
// createBatch reaches for the connection pool at module scope rather than
// through `db`, so the success path cannot be faked — what is testable of it is
// stagedBatchHref, which is why that is a function of its own.

function stubPage(handle: Handle<ImportPageProps>) {
  return () => handle.props.error as unknown as RemixNode
}

const user = { id: 7, display_name: 'Ada', email: 'ada@example.test' } as User

interface Rendered {
  type: unknown
  props: ImportPageProps
  init?: ResponseInit
}

// Enough context for the actions: they read auth, the form data and the
// database, and render. `render` keeps the node instead of turning it into
// HTML — the element carries the props, which is what these assertions are
// about.
function fakeContext(options: {
  formData?: FormData
  findOne?: () => Promise<ImportBatch | null>
}): { context: AuthedControllerContext; rendered: Rendered[] } {
  const rendered: Rendered[] = []
  const db = { findOne: options.findOne ?? (async () => null) }

  const context = {
    get(key: unknown) {
      if (key === Auth) return { ok: true, identity: user, method: 'session' }
      if (key === Database) return db
      if (key === FormData) return options.formData ?? new FormData()
      throw new Error('the actions asked for a context entry the fake does not carry')
    },
    render(node: { type: unknown; props: ImportPageProps }, init?: ResponseInit) {
      rendered.push({ type: node.type, props: node.props, init })
      return new Response(null, init)
    },
  }

  return { context: context as unknown as AuthedControllerContext, rendered }
}

function actionsWith(parse: (file: File) => Promise<ParsedUpload>) {
  return createFileImportActions({
    mediaType: 'book',
    source: 'goodreads',
    page: stubPage,
    fieldName: 'library',
    parse,
    missingFileError: 'Choose a file first.',
    emptyError: 'Nothing importable in there.',
  })
}

const neverParsed = async (): Promise<ParsedUpload> => {
  throw new Error('parse should not have been reached')
}

function formWith(field: string, file: File | string): FormData {
  const form = new FormData()
  form.set(field, file)
  return form
}

describe('staged batch href', () => {
  it('carries no marker when the source reports nothing about reviews', () => {
    // Goodreads' adapter returns rows only, so reviewsOnly arrives undefined.
    assert.equal(stagedBatchHref('abc'), '/profile/imports/abc')
    assert.equal(stagedBatchHref('abc', undefined), '/profile/imports/abc')
  })

  it('carries no marker when the upload held more than reviews', () => {
    assert.equal(stagedBatchHref('abc', false), '/profile/imports/abc')
  })

  it('marks the batch when the upload held only reviews', () => {
    assert.equal(stagedBatchHref('abc', true), '/profile/imports/abc?partial=reviews')
  })
})

describe('file import upload', () => {
  it('refuses a form with no file, without parsing', async () => {
    const { context, rendered } = fakeContext({})
    const response = await actionsWith(neverParsed).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0]!.props.error, 'Choose a file first.')
    assert.equal(rendered[0]!.type, stubPage)
    assert.equal(rendered[0]!.props.displayName, 'Ada')
  })

  it('refuses an empty file, without parsing', async () => {
    const form = formWith('library', new File([], 'export.csv'))
    const { context, rendered } = fakeContext({ formData: form })
    const response = await actionsWith(neverParsed).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered[0]!.props.error, 'Choose a file first.')
  })

  it('refuses a field holding something that is not a file', async () => {
    // A text field under the same name is not an upload, and must not be
    // handed to a parser expecting file contents.
    const { context, rendered } = fakeContext({ formData: formWith('library', 'not a file') })
    const response = await actionsWith(neverParsed).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered[0]!.props.error, 'Choose a file first.')
  })

  it('reads the field the config names, not another one', async () => {
    // The two controllers disagree on this: books posts `library`, movies
    // posts `ratings`. A file under the wrong name is no file at all.
    const { context, rendered } = fakeContext({
      formData: formWith('ratings', new File(['x'], 'export.csv')),
    })
    const response = await actionsWith(neverParsed).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered[0]!.props.error, 'Choose a file first.')
  })

  it('refuses an upload that parsed to no rows', async () => {
    const { context, rendered } = fakeContext({
      formData: formWith('library', new File(['title,year'], 'export.csv')),
    })
    const response = await actionsWith(async () => ({ rows: [] })).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered[0]!.props.error, 'Nothing importable in there.')
  })

  it("reports a parser's own message, since it is written to be read", async () => {
    // parseLetterboxdUpload throws prose when handed a bare csv instead of the
    // zip; that wording is the whole point and has to reach the page.
    const { context, rendered } = fakeContext({
      formData: formWith('library', new File(['x'], 'export.csv')),
    })
    const response = await actionsWith(async () => {
      throw new Error('That looks like a single file rather than the export archive.')
    }).upload(context)

    assert.equal(response.status, 400)
    assert.equal(
      rendered[0]!.props.error,
      'That looks like a single file rather than the export archive.',
    )
  })

  it('falls back to a general message when a parser throws a non-Error', async () => {
    const { context, rendered } = fakeContext({
      formData: formWith('library', new File(['x'], 'export.csv')),
    })
    const response = await actionsWith(async () => {
      throw 'a string'
    }).upload(context)

    assert.equal(response.status, 400)
    assert.equal(rendered[0]!.props.error, 'Something went wrong reading that file.')
  })

  it('hands the parser the uploaded file itself, so decoding stays per source', async () => {
    let seen: string | null = null
    const { context } = fakeContext({
      formData: formWith('library', new File(['title,year\nDune,1965'], 'export.csv')),
    })

    await actionsWith(async (file) => {
      seen = await file.text()
      return { rows: [] }
    }).upload(context)

    assert.equal(seen, 'title,year\nDune,1965')
  })
})

describe('file import index', () => {
  it('offers the waiting import when one is still open', async () => {
    // Starting a second import would orphan a review left unfinished, so the
    // page has to be able to point back at it.
    const batch = { id: 'batch-1' } as ImportBatch
    const { context, rendered } = fakeContext({ findOne: async () => batch })

    await actionsWith(neverParsed).index(context)

    assert.equal(rendered[0]!.props.pendingHref, '/profile/imports/batch-1')
    assert.equal(rendered[0]!.props.displayName, 'Ada')
  })

  it('offers nothing when no import is waiting', async () => {
    const { context, rendered } = fakeContext({ findOne: async () => null })

    await actionsWith(neverParsed).index(context)

    assert.equal(rendered[0]!.props.pendingHref, undefined)
  })
})
