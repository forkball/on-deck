import { router } from '../../app/router.ts'
import { sessionCookie } from '../../app/middleware/session.ts'

// Drives the real router in process: the same middleware stack, controllers and
// route map server.ts serves, minus the socket. `router.fetch` is what the
// request listener calls, so a test that goes through here exercises everything
// an HTTP request would except node's parsing of the wire bytes.
//
// NODE_ENV=test is what makes this importable without SESSION_SECRET — see
// app/middleware/session.ts.

export const ORIGIN = 'http://router.test'

export interface RouterResponse {
  status: number
  headers: Headers
  body: string
  // Left as written rather than resolved against ORIGIN, since whether a
  // redirect stays same-origin is usually the thing under test.
  location: string | null
}

async function toRouterResponse(response: Response): Promise<RouterResponse> {
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
    location: response.headers.get('location'),
  }
}

export async function get(path: string): Promise<RouterResponse> {
  return toRouterResponse(await router.fetch(new Request(new URL(path, ORIGIN))))
}

// Posts a form the way a browser would, so the form-data middleware sees the
// content type it expects. Pass a string to send something malformed on purpose.
export async function post(path: string, body: Record<string, string> | string): Promise<RouterResponse> {
  const encoded = typeof body === 'string' ? body : new URLSearchParams(body).toString()
  const response = await router.fetch(
    new Request(new URL(path, ORIGIN), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: encoded,
    }),
  )
  return toRouterResponse(response)
}

// A multipart POST, which is the only way to put a non-string value in a field.
// Passing a File where a route expects text is the shape of malformed input a
// urlencoded body cannot express.
export async function postMultipart(path: string, body: FormData): Promise<RouterResponse> {
  return toRouterResponse(await router.fetch(new Request(new URL(path, ORIGIN), { method: 'POST', body })))
}

// The session cookie off a response, in the form a following request sends it
// back. Reads the name off the cookie itself: spelled here instead, renaming it
// would leave this returning null forever and every assertion passing vacuously.
export function sessionCookieFrom(response: RouterResponse): string | null {
  const prefix = `${sessionCookie.name}=`
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(prefix))
  return setCookie ? setCookie.split(';')[0]! : null
}
