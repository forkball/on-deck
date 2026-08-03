import type { TmdbSearchResult as CatalogSearchResult } from './tmdb.ts'

// Open Library needs no API key, but three quirks shape this file:
//  1. Covers 200 on a *missing* image (a 43-byte blank), so `?default=false`
//     is required to make absence detectable.
//  2. The index carries "SUMMARY of…" / "Study Guide…" spam. Real books have
//     readers and/or a cover; the spam has neither.
//  3. Titles are inconsistently split between title and subtitle, so the two
//     have to be joined to get a usable display title.
const OPEN_LIBRARY_BASE = 'https://openlibrary.org'

const SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'first_publish_year',
  'cover_i',
  'readinglog_count',
  'ratings_count',
  'number_of_pages_median',
  'subject',
  'isbn',
].join(',')

// Subjects are free-form and unbounded (15-44 per book, mixing BISAC codes,
// plot topics and awards), so unlike TMDB's fixed ids book genres are derived:
// an entry matches if any needle appears in any subject. Order matters — the
// list is truncated to TAG_LIMIT.
const GENRE_MATCHERS: [genre: string, needles: string[]][] = [
  ['graphic novel', ['graphic novel', 'comic book', 'comics', 'manga']],
  ['science fiction', ['science fiction', 'sci-fi', 'science-fiction']],
  ['fantasy', ['fantasy']],
  ['mystery', ['mystery', 'detective']],
  ['thriller', ['thriller', 'suspense']],
  ['horror', ['horror']],
  ['romance', ['romance', 'love stories']],
  ['crime', ['crime']],
  ['historical', ['historical fiction', 'historical']],
  ['biography', ['biography', 'memoir', 'autobiograph']],
  ['young adult', ['young adult', 'juvenile']],
  ['adventure', ['adventure']],
  ['poetry', ['poetry']],
  ['philosophy', ['philosophy']],
  ['science', ['popular science', 'mathematics', 'physics', 'chemistry', 'biology']],
  ['history', ['history']],
]

// The vocabulary offered by the recommendation genre filter.
export const BOOK_GENRES: string[] = GENRE_MATCHERS.map(([genre]) => genre).sort()

const TAG_LIMIT = 4

function deriveGenres(subjects: string[] | undefined): string[] {
  if (!subjects || subjects.length === 0) return []
  const lowered = subjects.map((subject) => subject.toLowerCase())
  const matched: string[] = []
  for (const [genre, needles] of GENRE_MATCHERS) {
    if (lowered.some((subject) => needles.some((needle) => subject.includes(needle)))) {
      matched.push(genre)
      if (matched.length === TAG_LIMIT) break
    }
  }
  return matched
}

interface OpenLibraryDoc {
  key: string
  title?: string
  subtitle?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  readinglog_count?: number
  ratings_count?: number
  isbn?: string[]
  number_of_pages_median?: number
  subject?: string[]
}

interface OpenLibrarySearchResponse {
  docs: OpenLibraryDoc[]
}

// The works endpoint returns `description` either as a bare string or as a
// { type, value } object, depending on the record's vintage.
interface OpenLibraryWork {
  description?: string | { value?: string }
}

// Work keys come back as "/works/OL123W"; stripped so external_id stays a
// bare token like every other provider's.
function toExternalId(key: string): string {
  return key.replace(/^\/works\//, '')
}

function coverUrl(coverId: number | undefined): string | null {
  // default=false turns a missing cover into a 404 rather than a 200 carrying
  // a blank placeholder, so the "no poster" fallback actually triggers.
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false` : null
}

// Self-published study aids that shadow popular books. Readership can't
// separate them (students give them more readers than most novels), so they're
// matched on the one consistent thing: title shape.
const STUDY_AID_TITLE = /^\s*(summary|study guide|workbook|analysis|conversation starters|key takeaways|sparknotes)\b|\bstudy guide\b/i

// Neither filter alone is enough: missing cover art marks index junk (real
// books have ~94% coverage), the title pattern catches study aids that do
// have covers.
function looksReal(doc: OpenLibraryDoc): boolean {
  if (!doc.cover_i) return false
  return !STUDY_AID_TITLE.test(doc.title ?? '')
}

function toResult(doc: OpenLibraryDoc): CatalogSearchResult {
  const title = doc.subtitle ? `${doc.title}: ${doc.subtitle}` : (doc.title ?? 'Untitled')

  return {
    externalId: toExternalId(doc.key),
    title,
    releaseYear: doc.first_publish_year ?? null,
    tags: deriveGenres(doc.subject),
    posterUrl: coverUrl(doc.cover_i),
    // How many people have this on a shelf.
    popularity: doc.readinglog_count ?? doc.ratings_count ?? 0,
    // The search index has no description; the works endpoint does, but that's
    // a second request per result.
    overview: null,
    runtimeMinutes: null,
    pageCount: doc.number_of_pages_median ?? null,
    creator: doc.author_name?.[0] ?? null,
  }
}

// Open Library resets connections often — measured two ECONNRESETs in three
// consecutive identical requests — so a wobble would otherwise fail a search
// page or kill an import mid-way.
const FETCH_ATTEMPTS = 3
const RETRY_BASE_MS = 400

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      // 5xx is worth another go; a 4xx means the request itself is wrong.
      if (response.ok || response.status < 500) return response
      lastError = new Error(`Open Library responded ${response.status}`)
    } catch (error) {
      lastError = error
    }

    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Open Library request failed')
}

async function searchOpenLibrary(query: string, limit: number): Promise<OpenLibraryDoc[]> {
  const url = new URL(`${OPEN_LIBRARY_BASE}/search.json`)
  url.searchParams.set('q', query)
  url.searchParams.set('fields', SEARCH_FIELDS)
  url.searchParams.set('limit', String(limit))

  const response = await fetchWithRetry(url)
  if (!response.ok) {
    throw new Error(`Open Library search failed: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as OpenLibrarySearchResponse
  return data.docs ?? []
}

// Descriptions are wiki-editable, so they collect SEO spam, trailing markdown
// link-reference blocks, and raw markdown that has no renderer here.
const PROMO_LABEL = /\b(pdf|epub|mobi|download|read online|free read)\b/i

function cleanDescription(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')

  // Trailing "[1]: https://…" reference definitions — common on classics
  // whose descriptions link sibling volumes.
  text = text.replace(/^[ \t]*\[[^\]]+\]:\s*\S+.*$/gm, '')

  // Drop download promos, keep the visible text of other links. The label
  // pattern allows one level of nesting — labels like "The Lord of the Rings
  // [3/9]" are common, and a plain [^\]]* would leave the URL behind.
  text = text.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*https?:[^)]*\)/g, (_match, label: string) =>
    PROMO_LABEL.test(label) ? '' : label,
  )

  // No markdown renderer on the detail page, so these would render literally.
  text = text.replace(/\*\*|__/g, '')
  text = text.replace(/\*([^*\n]+)\*/g, '$1')

  // A bare promo left dangling after the above, e.g. "… world. Stoner pdf".
  text = text.replace(/([.!?]\s*)[^.!?\n]{0,60}\b(pdf|epub|mobi)\b[\s.]*$/i, '$1')

  // Horizontal rules and the blank-line runs left by the deletions above.
  text = text.replace(/^\s*[-_*]{3,}\s*$/gm, '')
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// The search index carries no description at all — only the per-work record
// does. Fetched separately so a single lookup can fill it in, exactly as
// tmdb.ts leaves runtimeMinutes null on search and populates it on detail.
export async function getWorkDescription(externalId: string): Promise<string | null> {
  const key = toExternalId(externalId)
  if (!/^OL\d+W$/i.test(key)) return null

  const response = await fetchWithRetry(new URL(`${OPEN_LIBRARY_BASE}/works/${key}.json`))
  if (!response.ok) return null

  const work = (await response.json()) as OpenLibraryWork
  const description = typeof work.description === 'string' ? work.description : work.description?.value
  const cleaned = description ? cleanDescription(description) : ''
  return cleaned || null
}

// Deliberately keeps Open Library's own relevance ordering. Sorting by
// readership instead destroys it outright — `sort=readinglog` on a search for
// "project hail mary" returns Romeo and Juliet.
export async function searchBooks(query: string): Promise<CatalogSearchResult[]> {
  const docs = await searchOpenLibrary(query, 20)
  return docs.filter(looksReal).map(toResult)
}

// Resolves many ISBNs in one request.
//
// Looking them up individually costs ~1.8s each, so a few hundred books
// would take minutes; Open Library accepts an OR'd query, and the `isbn`
// field on each result maps hits back to the ISBN that asked for them.
// Returns a Map keyed by the *requested* ISBN, so callers can tell which
// rows matched and which didn't.
const ISBN_BATCH_LIMIT = 20

export async function getBooksByIsbns(isbns: string[]): Promise<Map<string, CatalogSearchResult>> {
  const found = new Map<string, CatalogSearchResult>()
  const wanted = isbns.map(normalizeIsbn).filter(Boolean)
  if (wanted.length === 0) return found

  for (let start = 0; start < wanted.length; start += ISBN_BATCH_LIMIT) {
    const batch = wanted.slice(start, start + ISBN_BATCH_LIMIT)
    const docs = await searchOpenLibrary(
      batch.map((isbn) => `isbn:${isbn}`).join(' OR '),
      // A single ISBN can resolve to several editions of the same work, so
      // allow more rows back than ISBNs requested.
      batch.length * 2,
    )

    const requested = new Set(batch)
    for (const doc of docs) {
      for (const isbn of doc.isbn ?? []) {
        const key = normalizeIsbn(isbn)
        if (requested.has(key) && !found.has(key)) found.set(key, toResult(doc))
      }
    }
  }

  return found
}

export function normalizeIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase()
}

// Accepts a work key (bare "OL123W" or the full "/works/OL123W" path) or an
// ISBN — the latter matters for the Goodreads importer, whose CSV carries
// ISBN13 and so can resolve exactly instead of guessing from a title.
export async function getBookById(externalId: string): Promise<CatalogSearchResult | null> {
  const trimmed = externalId.trim()
  if (!trimmed) return null

  const query = /^\d{10}(\d{3})?$/.test(trimmed.replace(/-/g, ''))
    ? `isbn:${trimmed.replace(/-/g, '')}`
    : `key:/works/${toExternalId(trimmed)}`

  const docs = await searchOpenLibrary(query, 1)
  if (docs.length === 0) return null

  const result = toResult(docs[0])
  // A by-id lookup is a single item, so the extra round trip for the
  // description is worth it here (unlike search, which would pay it per hit).
  return { ...result, overview: await getWorkDescription(result.externalId) }
}

// Open Library book pages are openlibrary.org/works/OL123W — accepted here so
// the "wrong book?" form can take a pasted URL, same as the TMDB one does.
export function parseOpenLibraryId(input: string): string | null {
  const trimmed = input.trim()
  if (/^OL\d+W$/i.test(trimmed)) return trimmed.toUpperCase()

  const match = trimmed.match(/openlibrary\.org\/works\/(OL\d+W)/i)
  return match ? match[1].toUpperCase() : null
}
