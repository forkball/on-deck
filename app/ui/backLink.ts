export interface BackLink {
  href: string
  label: string
}

// `from` is an untrusted query param: same-origin relative paths only, or every
// detail page becomes an open redirect dressed up as a "back" link.
function safeFrom(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

// Ordered most-specific first: /profile/watched has to beat /profile.
const DESTINATIONS: [test: RegExp, label: string][] = [
  [/^\/profile\/watched/, 'your log'],
  [/^\/profile\/following/, 'following'],
  [/^\/profile\/followers/, 'followers'],
  [/^\/profile/, 'your profile'],
  [/^\/(movies|tv|books)\/search/, 'search'],
  [/^\/recommendations\/\d+/, 'these recommendations'],
  [/^\/recommendations/, 'recommendations'],
  [/^\/users\/\d+\/watched/, 'their log'],
  [/^\/users\/\d+/, 'their profile'],
  [/^\/users\/search/, 'people'],
  [/^\/notifications/, 'notifications'],
]

// Only when there's somewhere meaningful to go back to. A fixed parent link
// would duplicate the nav; this appears only when the page was actually reached
// from somewhere, and names that place.
export function backLinkFrom(from: string | null | undefined): BackLink | null {
  const href = safeFrom(from)
  if (!href) return null

  const path = href.split('?')[0]
  const match = DESTINATIONS.find(([test]) => test.test(path))
  return { href, label: match ? `← Back to ${match[1]}` : '← Back' }
}
