import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'remix/ui/server'

import { MediaOrder } from '../app/actions/profile/edit/media-order.tsx'

describe('MediaOrder', () => {
  it('gives each move button the order it would leave', async () => {
    const html = await renderToString(<MediaOrder order={['book', 'movie', 'tv', 'game']} />)

    assert.match(html, /value="movie,book,tv,game"[^>]*aria-label="Move Movies up"/)
    assert.match(html, /value="book,tv,movie,game"[^>]*aria-label="Move Movies down"/)
    // The ends can't move further, and the way back to the default is offered.
    assert.match(html, /disabled[^>]*aria-label="Move Books up"/)
    assert.match(html, /disabled[^>]*aria-label="Move Games down"/)
    assert.match(html, /Back to the default order/)
  })

  it('offers no reset when the order is already the default', async () => {
    const html = await renderToString(<MediaOrder order={['movie', 'tv', 'book', 'game']} />)
    assert.doesNotMatch(html, /Back to the default order/)
  })
})
