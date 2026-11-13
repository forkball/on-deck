import { isIP } from 'node:net'

// The address a request came from, for the per-IP cap on reset links.
//
// Fly-Client-IP is set by Fly's proxy to the address that actually connected,
// replacing anything the client sent under that name — unlike X-Forwarded-For,
// which a client can start with whatever it likes and proxies only append to.
//
// Null when it is absent or isn't an address: a request that reached the app
// some way other than through Fly (local development, a test). Those are held
// to the per-account cap only, which is a weaker rule rather than a broken one.
export function clientIp(headers: Headers): string | null {
  const value = headers.get('fly-client-ip')?.trim()
  return value && isIP(value) ? value : null
}
