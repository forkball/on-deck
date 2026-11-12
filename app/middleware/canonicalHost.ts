import type { Middleware } from 'remix/router'

// Sends the app's other addresses — the `*.fly.dev` name Fly gives every app,
// and `www.` — to the one domain people should be on.
//
// One host matters for more than looks: the session cookie is host-only
// (middleware/session.ts sets no domain), so someone signed in on fly.dev is
// signed out on the real domain, and Steam's OpenID return_to is built from the
// host the request arrived on.
//
// Read from CANONICAL_HOST rather than written in, so it can't go live before
// the domain's certificate does: set it with `fly secrets set` once
// `fly certs show` says Issued. Unset, nothing is redirected.
//
// Only named aliases are redirected, not "anything that isn't canonical" — a
// stray CANONICAL_HOST in a local .env would otherwise bounce localhost to
// production.
export function canonicalHost(canonical = process.env.CANONICAL_HOST): Middleware {
  return (context, next) => {
    if (!canonical) return next()

    const url = new URL(context.request.url)
    const isAlias = url.hostname === `www.${canonical}` || url.hostname.endsWith('.fly.dev')
    if (!isAlias) return next()

    // 308 keeps the method and body, so a form posted mid-switch still lands.
    url.protocol = 'https:'
    url.host = canonical
    return new Response(null, { status: 308, headers: { Location: url.href } })
  }
}
