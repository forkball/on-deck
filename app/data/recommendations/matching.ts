import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { getCatalogProvider, type CatalogSearchResult, type LengthBucket } from '../catalog/provider.ts'
import { pool } from '../db.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import type { MediaType } from '../mediaItems.ts'
import { requestStructured } from './claude.ts'
import { CatalogUnavailableError, GenerationError } from './errors.ts'
import type { DecadeRelation, Pick } from './picks.ts'
import { track } from './timings.ts'

export interface Candidate {
  pick: Pick
  match: CatalogSearchResult
}

// These two are every outbound catalog request the pipeline makes, so timing
// them here covers all of it.
function searchForType(mediaType: MediaType, query: string): Promise<CatalogSearchResult[]> {
  return track('catalog.search', () => getCatalogProvider(mediaType).search(query))
}

function lookupForType(mediaType: MediaType, externalId: string): Promise<CatalogSearchResult | null> {
  return track('catalog.lookup', () => getCatalogProvider(mediaType).getById(externalId))
}

export function matchesDecade(
  releaseYear: number | null,
  decade: number,
  relation: DecadeRelation = 'within',
): boolean {
  if (releaseYear == null) return false
  if (relation === 'before') return releaseYear < decade
  if (relation === 'after') return releaseYear >= decade + 10
  return releaseYear >= decade && releaseYear < decade + 10
}

// Whether a pick's own answer satisfies the series lever.
//
// The model is the only source there is: no book catalog records whether a work
// belongs to a series, Google Books having stopped returning seriesInfo (see
// BOOK_SERIES_TYPES). So the prompt asks for series or standalone, asks the pick to
// label itself, and this holds it to the label — which catches the realistic
// failure, a model drifting off the constraint across eighteen picks, rather than
// one mislabelling a book it just named.
//
// No label is not a "no": a run resumed from a checkpoint written before the field
// was asked for carries picks without it, and dropping those would empty the run
// for a reason that has nothing to do with the books.
//
// Two model answers now overlap: part_of_series, asked only when this lever is set,
// and series_name, asked on every run for the dedupe. This reads the boolean, which
// is the one the prompt asks as a yes/no; a pick answering `true` with no name is
// therefore still part of a series here while spending no slot in the dedupe, which
// is the safe way round. Deriving one from the other would collapse the pair and the
// conditional schema with it — worth doing, and not worth doing in the same change
// as the lever it would alter.
export function matchesSeries(pick: Pick, series: string): boolean {
  if (pick.part_of_series == null) return true
  return series === 'series' ? pick.part_of_series : !pick.part_of_series
}

// Which year the decade lever is answered with.
//
// The catalog's, except for books. Google Books' publishedDate is the *edition*:
// Dune's search hits say 2005 and Neuromancer's 2000, and of 20 hits each, none
// carried the year the book was written. A decade read off that drops the very
// books it was asked for, and no lookup rescues it — the volume *is* an edition,
// so the by-id record says 2005 too. Nor is the earliest edition an answer: there
// is no editions-of-this-work endpoint to take a minimum over, only relevance
// search, which answers 2002 for Piranesi off a Year's Best anthology and 1980
// for Dune off Dune Messiah.
//
// So the pick's own year, which is the model answering the question the prompt
// asked ("originally released in the 1960s"). Unverified, and the only
// work-level year anything here holds.
//
// Open Library was the one other candidate, and both of its years measured worse.
// first_publish_year is derived — the minimum over every edition attached to the
// work — so one mis-dated edition record decides it: Slaughterhouse-Five answers
// 1956 off a Delta paperback with no ISBN, against 140 other editions starting at
// 1968. A minimum can only be dragged earlier, so the error is one-directional,
// never self-correcting, and worse as editions accumulate. The curated
// first_publish_date on the work record is absent on 5 of 7 titles probed and
// wrong where it isn't ("June 1953" for Rendezvous with Rama, published 1973),
// for a second request. A check wrong by a decade on a tenth of the shortlist
// drops more good picks than the model's year does.
export function decadeComesFromPick(mediaType: MediaType): boolean {
  return mediaType === 'book'
}

export function decadeYear(mediaType: MediaType, pick: Pick, match: CatalogSearchResult): number | null {
  return decadeComesFromPick(mediaType) ? pick.year : match.releaseYear
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// Lenient on purpose — verifyPicksAgainstOverviews is what catches a
// same-title-same-year-different-film.
const TITLE_SIMILARITY_THRESHOLD = 0.5

// Strips at the separator rather than allowing a prefix match: "Foundation" is a
// prefix of "Foundation and Empire", a different novel.
function withoutSubtitle(title: string): string {
  const [main] = title.split(/\s*[:–—]\s*/)
  return normalizeTitle(main ?? title)
}

// The half of sameness that needs no distance: the same title, or the same title
// with a subtitle on one side or the other. Named so chooseMatch can prefer these
// over the fuzzy ones without restating the rule — it had a copy of two of these
// three branches, and drifting copies of "is this the same book" is the last thing
// this file needs.
export function titlesMatchOutright(pickTitle: string, foundTitle: string): boolean {
  const a = normalizeTitle(pickTitle)
  const b = normalizeTitle(foundTitle)
  if (!a || !b) return false

  return a === b || a === withoutSubtitle(foundTitle) || withoutSubtitle(pickTitle) === b
}

export function titlesLikelyMatch(pickTitle: string, foundTitle: string): boolean {
  const a = normalizeTitle(pickTitle)
  const b = normalizeTitle(foundTitle)
  if (!a || !b) return false
  if (titlesMatchOutright(pickTitle, foundTitle)) return true

  const distance = levenshteinDistance(a, b)
  const similarity = 1 - distance / Math.max(a.length, b.length)
  return similarity >= TITLE_SIMILARITY_THRESHOLD
}

// What two picks have to share to be the same series, or null when a pick names
// none. Normalised because the model writes the name freely — "The Empyrean" in one
// pick and "Empyrean" in the next.
//
// The model is the only source, as with the series lever: no book catalog records
// series membership. Unlike that lever, this one is asked for on every run, because
// a run that spends four of its eight slots on two series is the complaint whatever
// was filtered.
function normalizeSeries(name: string): string | null {
  // The ampersand before normalising, or "Thorns & Roses" and "Thorns and Roses"
  // come out as different keys and the series is counted twice.
  //
  // Then the words around the name that get added or dropped freely between one
  // entry and its sibling: "The Empyrean", "Empyrean series", "The Empyrean
  // Trilogy" and "Empyrean Book 2" are one series, and a key that treats them as
  // four misses the duplicate it exists to catch. Catalogs vary the same way —
  // IGDB has both "Portal" and "The Legend of Zelda" as written.
  const key = normalizeTitle(name.replace(/&/g, ' and '))
    .replace(/^the /, '')
    .replace(/(?: (?:series|trilogy|saga|cycle|duology|quartet|collection|franchise|books?|\d+))+$/, '')
    .trim()

  return key || null
}

export function seriesKey(pick: Pick): string | null {
  return normalizeSeries(pick.series_name ?? '')
}

// Every series a candidate belongs to, the catalog's answer first.
//
// IGDB carries collections and franchises and returns both on search, so a game
// costs nothing to place and is placed by the provider rather than by the model.
// Books have no such field anywhere — Google Books dropped it and Open Library
// keeps it as a free-form subject — so they fall back to what the model said, which
// for them is the only answer there is. TMDB does carry belongs_to_collection, on
// its detail record only, and isn't asked for it yet: films fall back too.
//
// A list rather than one key, because IGDB's two groupings both count: Zelda games
// share a franchise while sitting in different collections, and either overlapping
// is enough to be the same series.
export function seriesKeysFor(pick: Pick, match: CatalogSearchResult): string[] {
  const fromCatalog = (match.series ?? []).map(normalizeSeries).filter((key): key is string => key != null)
  if (fromCatalog.length > 0) return [...new Set(fromCatalog)]

  const fromPick = seriesKey(pick)
  return fromPick ? [fromPick] : []
}

// Which hit a pick is about, out of everything the search returned.
//
// Title first, then year. The other way round let the year choose a hit that was
// never the book: asked for "Bitten" (2001), nearest-year picked "No Biting:
// Policy and Practice for Toddlers", and "Kushiel's Dart" picked "Rapport". Both
// were then dropped as title mismatches — losing the pick altogether, while the
// real book sat further down the same list. Five of eighteen went that way in one
// run, two of them recoverable.
//
// Null means no hit is this book, which is a different thing from a hit being the
// wrong edition, and is counted as such by the caller.
export function chooseMatch(pick: Pick, matches: CatalogSearchResult[]): CatalogSearchResult | null {
  const sameWork = matches.filter((match) => titlesLikelyMatch(pick.title, match.title))
  if (sameWork.length === 0) return null

  // Hits actually called what the pick is called, give or take a subtitle, ahead of
  // the ones that only clear the fuzzy check.
  //
  // What that buys: a sibling in the same series stops being eligible while the book
  // itself is in the results. Searching "A Court of Thorns and Roses" returns "A
  // Court of Mist and Fury" at 0.59 similarity — past the 0.5 the fuzzy check asks
  // for, and a different book. Raising that threshold instead would cost more than
  // it saves: "Foundation" against "Foundation and Empire" is already only 0.48, so
  // there is no room between the two, and a rejected fuzzy match loses the pick
  // altogether while this ordering loses nothing.
  const named = sameWork.filter((match) => titlesMatchOutright(pick.title, match.title))
  // Not `pool`: this module imports a database pool.
  const editions = named.length > 0 ? named : sameWork

  const distance = (match: CatalogSearchResult) => Math.abs((match.releaseYear ?? 0) - pick.year)

  return [...editions].sort(
    (a, b) =>
      // Nearest the pick's year: the work's year for a film, the closest pressing to
      // it for a book.
      distance(a) - distance(b) ||
      // Then the edition people actually have, and then the plainest title, which is
      // how "Iron Flame" wins over "Iron Flame: The Fiery Sequel to the Sunday Times
      // Bestseller and TikTok Sensation Fourth Wing".
      b.popularity - a.popularity ||
      a.title.length - b.title.length,
  )[0]
}

// Each verdict carries the index of the entry it's about, so answers pair up by
// id rather than by position — a verdict list one short would otherwise slide
// every answer after it onto the wrong film.
//
// The schema can't pin the array's length: structured output only accepts 0 or
// 1 for minItems, and a larger one fails the request outright (`400 ...
// 'minItems' values other than 0 or 1 are not supported`). applyVerdicts is
// what holds the model to one verdict per entry.
const VERIFY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          index: { type: 'number' as const },
          matches: { type: 'boolean' as const },
        },
        required: ['index', 'matches'],
      },
    },
  },
  required: ['verdicts'],
}

export interface PickVerdict {
  index: number
  matches: boolean
}

// Refuses anything it can't read unambiguously rather than filtering on a best
// guess: a verdict set that doesn't line up means we don't know which film each
// answer was about.
export function applyVerdicts(candidates: Candidate[], verdicts: PickVerdict[]): Candidate[] {
  if (!Array.isArray(verdicts)) throw mismatch(`verdicts came back as ${typeof verdicts}`)

  const byIndex = new Map<number, boolean>()

  for (const { index, matches } of verdicts) {
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      throw mismatch(`verdict for entry ${index}, which wasn't among the ${candidates.length} asked about`)
    }
    if (byIndex.has(index)) throw mismatch(`two verdicts for entry ${index}`)
    byIndex.set(index, matches)
  }

  if (byIndex.size !== candidates.length) {
    throw mismatch(`${byIndex.size} of ${candidates.length} entries answered`)
  }

  return candidates.filter((_, index) => byIndex.get(index) === true)
}

// Two audiences: GenerationError carries a message to the waiting page (see
// errors.ts), and the detail that would only puzzle them goes to the log.
function mismatch(detail: string): GenerationError {
  console.warn(`[generation] verification mismatch: ${detail}`)
  return new GenerationError('Checking the picks came back incomplete — try generating again.')
}

// A same-title-same-year-different-film sails through titlesLikelyMatch, since
// only the plot can tell them apart. One batched call for the whole list.
export async function verifyPicksAgainstOverviews(
  candidates: Candidate[],
  mediaType: MediaType = 'movie',
): Promise<Candidate[]> {
  if (candidates.length === 0) return []

  // From the registry — this prompt's whole job is telling similar entries
  // apart, so it has to name the catalog the entry actually came from.
  const { plural: noun, entryNoun, catalogName } = mediaTypeUiFor(mediaType)

  const items = candidates.map(({ pick, match }, index) => ({
    index,
    you_suggested: { title: pick.title, year: pick.year, your_reason: pick.reason },
    catalog_found: { title: match.title, year: match.releaseYear, overview: match.overview },
  }))

  const { verdicts } = await requestStructured<{ verdicts: PickVerdict[] }>('verify.model', {
    model: 'claude-sonnet-5',
    // Shared with the reasoning, as everywhere else. The verdicts themselves are
    // tiny — an index and a boolean each — but the judgement behind them is one
    // plot read against one title per entry.
    max_tokens: 6000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: VERIFY_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `You previously suggested some ${noun} by title/year. For each one, we looked it up on ${catalogName} and found ` +
          `a specific ${entryNoun} — here's what ${catalogName} returned, described by its own title, year, and plot ` +
          `overview. Confirm whether the ${entryNoun} found is truly the same one you meant, not just a ` +
          `similarly- or identically-titled different one. Small title differences (translation, punctuation, ` +
          `"the" vs no "the") are fine as long as it's the same ${entryNoun}.\n\n${JSON.stringify(items, null, 2)}\n\n` +
          `Return one verdict per entry, each repeating that entry's "index" from above, with "matches" true ` +
          `only if the ${entryNoun} found is genuinely the one you meant. Every entry needs exactly one ` +
          `verdict — order doesn't matter, since the index is what pairs them up.`,
      },
    ],
  })
  return applyVerdicts(candidates, verdicts)
}

const LOOKUP_CONCURRENCY = 8

// Held apart from LOOKUP_CONCURRENCY even though both are 8: the searches are a
// different burst against a different provider, and one should be tunable
// without silently moving the other. 8 is the width a run was observed
// completing at; 18 at once is the width one was observed failing at.
const SEARCH_CONCURRENCY = 8

// A worker pool rather than Promise.all: these run against a rate-limited
// provider, and a run can carry 25 picks.
async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      await operation(items[next++])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// One wording for one condition, however many stages reach it.
function catalogDown(what: string): GenerationError {
  return new CatalogUnavailableError(
    `${what} — the catalog isn't answering right now. Try generating again in a few minutes.`,
  )
}

export type CatalogSearch = (mediaType: MediaType, query: string) => Promise<CatalogSearchResult[]>

// One search per pick the local catalog didn't already answer for, bounded —
// `Promise.all` put all 18 of a filtered run's on the wire at once, and one of
// them throwing took the whole run with it after the picks were paid for.
//
// A failed search leaves that pick with no matches, which the caller counts as
// unfound and drops. All of them failing with nothing rescued locally is the
// catalog being unreachable, not that many unfindable titles.
export async function searchForPicks(
  mediaType: MediaType,
  picks: Pick[],
  fromCatalog: Map<number, CatalogSearchResult>,
  search: CatalogSearch = searchForType,
): Promise<CatalogSearchResult[][]> {
  const matches: CatalogSearchResult[][] = []
  const toSearch: number[] = []
  let failed = 0

  picks.forEach((_, index) => {
    const local = fromCatalog.get(index)
    matches.push(local ? [local] : [])
    if (!local) toSearch.push(index)
  })

  await forEachWithConcurrency(toSearch, SEARCH_CONCURRENCY, async (index) => {
    try {
      matches[index] = await search(mediaType, picks[index].title)
    } catch (error) {
      failed++
      console.warn(
        `[generation] ${mediaType} search failed for ${JSON.stringify(picks[index].title)}:`,
        error,
      )
    }
  })

  if (toSearch.length > 0 && failed === toSearch.length && fromCatalog.size === 0) {
    throw catalogDown("Couldn't look up any of the picks")
  }

  return matches
}

// A by-id lookup that answers null rather than throwing: a provider refusing
// one id is a verdict about that candidate, not grounds to fail a run that has
// already paid for its picks. Callers below decide what a null means.
export type CatalogLookup = (mediaType: MediaType, externalId: string) => Promise<CatalogSearchResult | null>

async function lookupQuietly(
  lookup: CatalogLookup,
  mediaType: MediaType,
  externalId: string,
): Promise<CatalogSearchResult | null> {
  try {
    return await lookup(mediaType, externalId)
  } catch (error) {
    console.warn(`[generation] ${mediaType} lookup failed for ${externalId}:`, error)
    return null
  }
}

// TMDB returns descriptions on search; Open Library only on the per-work record.
// Without one, verifyPicksAgainstOverviews rubber-stamps every book.
export async function withOverviews(
  candidates: Candidate[],
  mediaType: MediaType,
  lookup: CatalogLookup = lookupForType,
): Promise<Candidate[]> {
  const missing = candidates.filter(({ match }) => !match.overview)
  if (missing.length === 0) return candidates

  await forEachWithConcurrency(missing, LOOKUP_CONCURRENCY, async (entry) => {
    const detail = await lookupQuietly(lookup, mediaType, entry.match.externalId)
    if (detail?.overview) entry.match = { ...entry.match, overview: detail.overview }
  })

  return candidates
}

// Whether a genre a search hit doesn't carry counts as an answer.
//
// For books it doesn't: Google Books returns only the top-level BISAC category
// on search ("Fiction"), and the hierarchical ones the genres are derived from
// ("Fiction / Science Fiction / Space Opera") on the by-id record alone, so a
// science fiction novel arrives with no genre tag at all. A tag a hit does carry
// is real either way, which is what keeps this to one request per miss rather
// than one per candidate. One media type rather than a provider flag because it
// is the provider's search payload that is thin, not the medium.
export function genreMissNeedsLookup(mediaType: MediaType): boolean {
  return mediaType === 'book'
}

// The shape both detail filters below share: a dimension a search hit may not
// carry, a by-id record that does, and the reading that every lookup coming back
// empty is the provider being down rather than a lever nothing matched.
//
// One function rather than two of the same, because that last rule is the subtle
// part. "Kept nothing, asked about some, got only nulls" is not something a reader
// checks by eye, and a second copy would have to be kept in agreement by whoever
// next changes either lever.
//
// `answered` is whether the search hit can decide the candidate on its own; only
// the ones it can't are looked up. That keeps this to one request per undecidable
// candidate rather than one per candidate.
interface DetailRule {
  answered: (match: CatalogSearchResult) => boolean
  matches: (match: CatalogSearchResult) => boolean
  // Names the dimension in the line someone waiting on the run reads.
  what: string
}

async function filterByDetail(
  candidates: Candidate[],
  mediaType: MediaType,
  rule: DetailRule,
  lookup: CatalogLookup,
): Promise<Candidate[]> {
  const needLookup = new Set(candidates.filter(({ match }) => !rule.answered(match)))
  // Null marks a lookup that answered nothing: no record, no verdict, so it can't
  // be kept. Held beside the entry so the loop below stays a pure read.
  const resolved = new Map<Candidate, CatalogSearchResult | null>()

  await forEachWithConcurrency([...needLookup], LOOKUP_CONCURRENCY, async (entry) => {
    resolved.set(entry, await lookupQuietly(lookup, mediaType, entry.match.externalId))
  })

  const kept: Candidate[] = []
  for (const entry of candidates) {
    if (!needLookup.has(entry)) {
      if (rule.matches(entry.match)) kept.push(entry)
      continue
    }

    const detail = resolved.get(entry) ?? null
    // A lookup that answered nothing leaves the search hit as the only thing that
    // has spoken, so it is asked instead — under the same rule, which is what keeps
    // this from being a second, looser policy. For a length that settles it: a hit
    // with no page count can't match a length. For a genre it depends on what the
    // hit carried: tags that name another genre are evidence, an empty list is the
    // catalog never having said.
    //
    // Eleven of one run's eighteen picks were dropped as "not romance" by lookups
    // that never landed — Open Library ids asked of Google Books, during a Google
    // outage. Neither the id nor the outage was a fact about the book.
    if (!rule.matches(detail ?? entry.match)) continue
    if (!detail) {
      kept.push(entry)
      continue
    }

    // The by-id record's title only replaces the search hit's if it is still
    // recognisably the book. Google answers with two different titles for one
    // volume: dIIO0AEACAAJ is "Iron Flame: The Fiery Sequel to the Sunday Times
    // Bestseller and TikTok Sensation Fourth Wing" in search and "Iron Flame.
    // Limited Special Edition - Sprayed Edges" by id. The search title is the one
    // that was checked against the pick; the second was never checked, and it is
    // what got stored and shown for a run.
    const title = titlesLikelyMatch(entry.pick.title, detail.title) ? detail.title : entry.match.title
    // The detail record, not the search one: it carries the dimension that was just
    // paid for, and whatever else the search payload omitted.
    kept.push({ pick: entry.pick, match: { ...detail, title } })
  }

  // Dropping one candidate the provider wouldn't answer for is the rule working.
  // Dropping every one of them, with nothing left that the search hit could decide,
  // is the provider being down — and a run saved from that is an empty page reading
  // as "nothing matched", which is a different and untrue thing. Say so instead.
  if (kept.length === 0 && needLookup.size > 0 && [...resolved.values()].every((detail) => detail == null)) {
    throw catalogDown(`Couldn't check the ${rule.what} of any of the ${mediaTypeUiFor(mediaType).plural}`)
  }

  return kept
}

// Keeps only the candidates carrying the requested genre, fetching the by-id record
// for the ones whose search hit couldn't answer.
//
// Runs before filterByLength, so a candidate looked up here arrives there carrying
// a detail record that already holds the page count — one lookup serving both
// levers. Only for the candidates this one did look up, though: a hit that carried
// the genre is passed through as it came, and still owes filterByLength a request.
export function filterByGenre(
  candidates: Candidate[],
  mediaType: MediaType,
  genre: string,
  lookup: CatalogLookup = lookupForType,
): Promise<Candidate[]> {
  // Constant for the call, not per candidate.
  const needsLookup = genreMissNeedsLookup(mediaType)
  const carriesGenre = (match: CatalogSearchResult) => match.tags.includes(genre)

  // A Google Books record with no categories at all is not a book of some other
  // genre — it is a record nobody catalogued. Older works are full of them: of
  // eight romance titles probed, the editions for Rebecca, Emma and It carried no
  // categories on any edition the search returned, so requiring a positive tag
  // threw away every classic and left a romance run with nothing in it.
  //
  // Unknown is not a no, so it is kept, and the prompt's own clause is what stands
  // behind it — the same standing the decade and series levers have for books. A
  // record that *does* carry categories is still held to them: that is real
  // evidence, and a book tagged only [horror] is not the romance that was asked
  // for.
  return filterByDetail(
    candidates,
    mediaType,
    {
      // Every provider but Google Books answers genres on search, so for them a miss
      // is the answer and nothing is looked up.
      answered: (match) => carriesGenre(match) || !needsLookup,
      matches: (match) => carriesGenre(match) || (needsLookup && match.tags.length === 0),
      what: 'genre',
    },
    lookup,
  )
}

// Whether the by-id lookup can be skipped.
export function hasLengthDimension(mediaType: MediaType, result: CatalogSearchResult): boolean {
  if (mediaType === 'book') return result.pageCount != null
  if (mediaType === 'game') return result.playtimeHours != null
  if (mediaType === 'tv') return result.seasonCount != null
  return result.runtimeMinutes != null
}

// Keeps only the candidates matching the requested length, fetching the dimension
// for the ones whose search result didn't carry it.
//
// No provider returns length on search, only on by-id, so this is a second round of
// requests — but only for the candidates that need it, and only when the lever is
// set. The fan-out is bounded, not serial.
export function filterByLength(
  candidates: Candidate[],
  mediaType: MediaType,
  length: LengthBucket,
  lookup: CatalogLookup = lookupForType,
): Promise<Candidate[]> {
  const provider = getCatalogProvider(mediaType)

  return filterByDetail(
    candidates,
    mediaType,
    {
      answered: (match) => hasLengthDimension(mediaType, match),
      matches: (match) => provider.matchesLength(match, length),
      what: 'length',
    },
    lookup,
  )
}

const YEAR_TOLERANCE = 1

// Resolves picks against the catalog we already hold, so a provider is only
// asked about titles we've never seen (~21% of picks are already there).
//
// The match is tight on purpose: normalised title equality *and* release year
// within one, since a looser rule confuses same-titled works from different eras
// (Dune 1984 and 2021).
//
// A row with no overview counts as a miss — verifyPicksAgainstOverviews judges
// on plot text, so skipping the provider would skip the only check that catches
// a wrong match. Only ~12% of books carry one.
//
// Raw SQL because the normalisation has to happen in the database. Matches
// normalizeTitle exactly.
export async function resolveFromCatalog(
  mediaType: MediaType,
  picks: Pick[],
): Promise<Map<number, CatalogSearchResult>> {
  const resolved = new Map<number, CatalogSearchResult>()
  if (picks.length === 0) return resolved

  const wanted = picks.map((pick) => normalizeTitle(pick.title))

  // Timed alongside the provider calls it exists to avoid, so the saving is
  // legible rather than assumed.
  const { rows } = await track('catalog.local', () =>
    pool.query<{
      id: number
      external_id: string
      title: string
      metadata: string
      popularity_score: number | null
      normalized: string
    }>(
      `select id, external_id, title, metadata, popularity_score,
            btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9[:space:]]', '', 'g'), '\\s+', ' ', 'g')) as normalized
       from media_items
      where type = $1
        and btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9[:space:]]', '', 'g'), '\\s+', ' ', 'g')) = any($2)`,
      [mediaType, wanted],
    ),
  )
  if (rows.length === 0) return resolved

  const byTitle = new Map<string, typeof rows>()
  for (const row of rows) {
    byTitle.set(row.normalized, [...(byTitle.get(row.normalized) ?? []), row])
  }

  for (const [index, pick] of picks.entries()) {
    const candidates = byTitle.get(normalizeTitle(pick.title))
    if (!candidates) continue

    for (const row of candidates) {
      const metadata = parseMediaMetadata(row.metadata)
      if (metadata.releaseYear == null) continue
      if (Math.abs(metadata.releaseYear - pick.year) > YEAR_TOLERANCE) continue
      // No overview, no verification — so no shortcut.
      if (!metadata.overview) continue

      resolved.set(index, {
        externalId: row.external_id,
        title: row.title,
        releaseYear: metadata.releaseYear,
        tags: metadata.tags,
        posterUrl: metadata.posterUrl,
        popularity: Number(row.popularity_score ?? 0),
        overview: metadata.overview,
        runtimeMinutes: metadata.runtimeMinutes,
        pageCount: metadata.pageCount,
        playtimeHours: metadata.playtimeHours,
        seasonCount: metadata.seasonCount,
        creator: metadata.creator,
        images: metadata.images,
        platforms: metadata.platforms,
        series: metadata.series,
      })
      break
    }
  }

  return resolved
}
