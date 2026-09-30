// Apart from provider.ts, which holds the registry, so that every provider can
// import this without the cycle that importing the registry would make.
//
// What we know about the work we are looking for, before any provider has seen it.
// Handed to `search` in this shape rather than pre-flattened into one string,
// because the string is the provider's dialect and not the caller's business:
// Google Books confines a term to a field with `intitle:`/`inauthor:`, and the
// Open Library fallback behind it reads those as words to search for. Flattening
// early is what made `isbn:` — a Google Books qualifier — reach Open Library as
// text, which matcher.ts had to detect after the fact.
//
// `title` and `text` are the same words with different warrants, and the difference
// is load-bearing. A pick or a CSV row gives a title, so a provider may confine it
// to its title field. A search box gives text: someone typing an author, a series or
// half a title has to find something, and `intitle:` would answer nothing — and then
// cost a second request to discover that, on the path the typeahead uses.
export interface CatalogQuery {
  title?: string
  text?: string
  creator?: string | null
  isbn?: string | null
}

// The words to search for, for the providers that hold titles and nothing else to
// match against and so have no use for the distinction above.
export function queryWords(query: CatalogQuery): string {
  return query.title ?? query.text ?? ''
}
