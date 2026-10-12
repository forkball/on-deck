import type { Middleware } from 'remix/router'

// A form posted in place (app/browser/shared/submit-in-place.ts) only needs to
// know where the redirect points — to spot `?error=` — before the page reloads
// itself. Following the redirect would render that page once for nothing, so
// the redirect is answered as a 204 carrying its target instead.
export function inPlace(): Middleware {
  return async (context, next) => {
    const response = await next()
    if (!context.request.headers.has('x-in-place')) return response
    const location = response.headers.get('Location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    return new Response(null, { status: 204, headers: { 'x-location': location } })
  }
}
