import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'remix/ui/server'

import { Markdown, markdownToPlainText, parseMarkdown } from '../app/ui/components/markdown.tsx'

describe('markdown', () => {
  it('renders emphasis and keeps paragraphs apart', async () => {
    const html = await renderToString(
      <Markdown text={"**Have you got the Guts?**\n\nKentaro Miura's *Berserk* has outraged."} />,
    )
    assert.match(html, /<p><strong>Have you got the Guts\?<\/strong><\/p>/)
    assert.match(html, /<p>Kentaro Miura(&#x27;|&#39;|')s <em>Berserk<\/em> has outraged\.<\/p>/)
  })

  it('keeps a single newline as a line break', () => {
    assert.deepEqual(parseMarkdown('one\ntwo'), [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'one' }, { type: 'break' }, { type: 'text', value: 'two' }],
      },
    ])
  })

  it("resolves Open Library's reference links and lists", async () => {
    const html = await renderToString(
      <Markdown
        text={
          '----------\nContains:\n\n- [Volume 1](https://openlibrary.org/works/OL1W)\n- Volume 2\n\n([source][1])\n\n  [1]: https://example.com/'
        }
      />,
    )
    assert.match(html, /<hr/)
    assert.match(
      html,
      /<ul><li><a [^>]*href="https:\/\/openlibrary\.org\/works\/OL1W"[^>]*>Volume 1<\/a><\/li><li>Volume 2<\/li><\/ul>/,
    )
    assert.match(html, /\(<a [^>]*href="https:\/\/example\.com\/"[^>]*>source<\/a>\)/)
    assert.doesNotMatch(html, /\[1\]/)
  })

  it('never emits HTML or a non-http link', async () => {
    const html = await renderToString(<Markdown text={'<script>x</script> [click](javascript:alert(1))'} />)
    assert.doesNotMatch(html, /<script>/)
    assert.doesNotMatch(html, /javascript:/)
    assert.match(html, /click/)
  })

  it('leaves stray delimiters and snake_case alone', () => {
    assert.equal(
      markdownToPlainText('5 * 3 = 15, a_b_c, and **unclosed'),
      '5 * 3 = 15, a_b_c, and **unclosed',
    )
    assert.equal(markdownToPlainText('\\*literal\\*'), '*literal*')
  })

  it('strips the markup for plain text', () => {
    assert.equal(
      markdownToPlainText('**Bold** and [a link](https://x.y)\n\n- one\n- two'),
      'Bold and a link\n\n• one\n• two',
    )
  })
})
