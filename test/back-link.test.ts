import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { backLinkFrom, RETURN_TO_PARAM, withReturnTo } from '../app/ui/backLink.ts'

// Both ends of the return-path contract: a list writes where it was opened
// from, and the page it opens reads that back to offer a way there. They only
// work if they agree, which is why they live in one module.

describe('withReturnTo', () => {
  it('names the parameter rather than spelling it', () => {
    assert.equal(withReturnTo('/movies/12', '/profile'), `/movies/12?${RETURN_TO_PARAM}=%2Fprofile`)
  })

  it('encodes a return path that carries its own query', () => {
    // Unencoded, the `&` would read as another parameter of the outer URL and
    // the filter would be lost on the way back.
    const href = withReturnTo('/books/7', '/profile/watched?page=2&type=book')
    const back = new URL(href, 'https://x.test').searchParams.get(RETURN_TO_PARAM)
    assert.equal(back, '/profile/watched?page=2&type=book')
  })

  it('survives the round trip back out through backLinkFrom', () => {
    for (const to of ['/', '/profile', '/users/3?tab=game', '/profile?q=a b&e=🎲']) {
      const href = withReturnTo('/tv/900', to)
      const parsed = new URL(href, 'https://x.test').searchParams.get(RETURN_TO_PARAM)
      assert.equal(parsed, to)
      assert.equal(backLinkFrom(parsed)?.href, to)
    }
  })
})

describe('backLinkFrom', () => {
  it('offers nothing when the page was not reached from anywhere', () => {
    assert.equal(backLinkFrom(null), null)
    assert.equal(backLinkFrom(undefined), null)
    assert.equal(backLinkFrom(''), null)
  })

  it('refuses anything that could leave the site', () => {
    // `from` arrives in the query string, so without this every detail page is
    // an open redirect wearing a "back" link.
    for (const hostile of [
      'https://evil.test/phish',
      '//evil.test/phish',
      'http://evil.test',
      'javascript:alert(1)',
      'evil.test',
    ]) {
      assert.equal(backLinkFrom(hostile), null, hostile)
    }
  })

  it('names where it is going', () => {
    assert.equal(backLinkFrom('/profile/watched?page=2')?.label, '← Back to your log')
    assert.equal(backLinkFrom('/users/12/watched')?.label, '← Back to their log')
    assert.equal(backLinkFrom('/recommendations/41')?.label, '← Back to these recommendations')
    assert.equal(backLinkFrom('/recommendations')?.label, '← Back to recommendations')
    assert.equal(backLinkFrom('/notifications')?.label, '← Back to notifications')
  })

  it('takes the more specific destination when two could match', () => {
    // /profile/watched has to beat /profile, and /users/N/watched has to beat
    // /users/N — both pairs are ordered, not disjoint.
    assert.equal(backLinkFrom('/profile/watched')?.label, '← Back to your log')
    assert.equal(backLinkFrom('/profile')?.label, '← Back to your profile')
    assert.equal(backLinkFrom('/users/12/watched')?.label, '← Back to their log')
    assert.equal(backLinkFrom('/users/12')?.label, '← Back to their profile')
  })

  it('names the landing page, which its feed links into', () => {
    assert.equal(backLinkFrom('/')?.label, '← Back to home')
    assert.equal(backLinkFrom('/')?.href, '/')
  })

  it('does not let the landing page rule swallow every other path', () => {
    // The rule for '/' is exact. A prefix match would make every path "home",
    // since they all start with one.
    assert.equal(backLinkFrom('/profile')?.label, '← Back to your profile')
    assert.equal(backLinkFrom('/notifications')?.label, '← Back to notifications')
  })

  it('still goes back when the destination has no name for it', () => {
    // Somewhere real but unlisted is still somewhere to return to.
    const link = backLinkFrom('/some/unlisted/page')
    assert.equal(link?.href, '/some/unlisted/page')
    assert.equal(link?.label, '← Back')
  })

  it('matches on the path, ignoring the query', () => {
    assert.equal(backLinkFrom('/profile/watched?page=9&type=game')?.label, '← Back to your log')
  })
})
