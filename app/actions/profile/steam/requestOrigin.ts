// The origin the *browser* is on, which is not always the one the server sees.
//
// Fly terminates TLS at its proxy and forwards plain HTTP to the app, so
// `context.url.origin` reads `http://on-deck.fly.dev` for a request the user
// made over HTTPS. That only matters where the origin is handed to a third
// party — Steam's OpenID `realm` and `return_to` have to match where the
// browser actually is, or Steam sends people back to an http:// URL.
//
// Only the scheme comes from a header. X-Forwarded-* is client-supplied unless
// a proxy overwrites it, so honouring a forwarded *host* would let anyone point
// `return_to` at a domain they control; a spoofed scheme can only downgrade the
// caller's own redirect.
export function externalOrigin(url: URL, headers: Headers): string {
  // Proxies append rather than replace, so a chain gives "https, http".
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwarded === 'https' || forwarded === 'http' ? `${forwarded}:` : url.protocol

  return `${protocol}//${url.host}`
}
