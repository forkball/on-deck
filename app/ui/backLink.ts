export interface BackLink {
  href: string
  label: string
}

// `from` is an untrusted query param, so the same rule the login controller
// applies to `next`/`return_to` applies here: same-origin relative paths only.
// Rendering it unchecked would turn every detail page into an open redirect
// dressed up as a "back" link.
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

// Builds the "back" link for a detail page, but only when there's somewhere
// meaningful to go back to.
//
// The blanket per-page back links this replaces were removed because they
// were noise: they pointed at a fixed parent whether or not you'd come from
// there, duplicating the nav. This only appears when the page was actually
// reached from somewhere (the `?from=` the app already threads through), and
// names that place — so it tells you something the nav can't.
export function backLinkFrom(from: string | null | undefined): BackLink | null {
  const href = safeFrom(from)
  if (!href) return null

  const path = href.split('?')[0]
  const match = DESTINATIONS.find(([test]) => test.test(path))
  return { href, label: match ? `← Back to ${match[1]}` : '← Back' }
}
