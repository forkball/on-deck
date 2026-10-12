import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'remix/ui/server'

import { MediaTypeTag } from '../app/ui/components/media-type-tag.tsx'

describe('MediaTypeTag', () => {
  it("names the type in the registry's own words", async () => {
    assert.match(await renderToString(<MediaTypeTag type="tv" />), />TV show<\/span>$/)
    assert.match(await renderToString(<MediaTypeTag type="book" />), />book<\/span>$/)
  })
})
