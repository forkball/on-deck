// Looks every staged row up in the catalog, then resolves the batch as a whole.
//
// This is the phase that used to run inside the upload request. At the bound
// below, 400 rows is ~50 sequential rounds of one search plus a few database
// round trips — tens of seconds, which is survivable in a request but loses the
// whole import to any timeout, and gives the person nothing to come back to.

import { IGDB_MAX_CONCURRENCY } from '../catalog/igdb.ts'
import {
  getCatalogProvider,
  upsertCatalogItem,
  type CatalogProvider,
  type CatalogSearchResult,
} from '../catalog/provider.ts'
import type { CatalogQuery } from '../catalog/query.ts'
import type { Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import { INTERACTION_SOURCES, type ImportBatch, type ImportRow } from '../schema.ts'
import {
  finishMatching,
  loadPastAnswers,
  loadRows,
  mergeEditions,
  recordMatch,
  rememberRows,
  setMatchedCount,
  touchClaim,
} from './batches.ts'
import { answerKey, inlineAlternates, type CandidateLike } from './classify.ts'
import { runBounded } from './csv.ts'
import { resolveBatch, type MatchInput, type MatchOutcome } from './resolve.ts'
import { matchSteamTitle } from './steam.ts'

// The same ceiling the in-request importer used. Raising it makes the catalog's
// rate limit the binding constraint rather than ours.
const CONCURRENCY = 8

// How often the row counter and the claim heartbeat are written. Per row would
// be a write per search; per batch would let a live import look dead.
const PROGRESS_STRIDE = 10

// A failed lookup lands the row in "couldn't find" rather than failing the import.
async function searchQuietly(
  provider: { search(query: CatalogQuery): Promise<CatalogSearchResult[]> },
  query: CatalogQuery,
): Promise<CatalogSearchResult[]> {
  try {
    return await provider.search(query)
  } catch {
    return []
  }
}

// How a source's rows are looked up and settled. Chosen by the batch's source
// rather than its media type: what decides it is what the source tells us about
// a row, and a Steam library and a hypothetical games CSV would differ.
interface MatchStrategy {
  // Each row's outcome, plus the inputs that inline alternates are drawn from
  // (empty for a strategy that offers none).
  resolve(
    provider: CatalogProvider,
    rows: ImportRow[],
    details: Map<string, CatalogSearchResult>,
    concurrency: number,
    progress: () => Promise<void>,
  ): Promise<{ outcomes: MatchOutcome[]; inputs: MatchInput[] }>
  // Whether two rows landing on one catalog entry are one thing listed twice,
  // to be folded together (mergeEditions), rather than a question for review.
  mergesEditions: boolean
}

// The file importers: title (and creator or isbn) searched once, then settled
// across the whole batch by year — see resolve.ts.
const byYear: MatchStrategy = {
  mergesEditions: false,
  async resolve(provider, rows, details, concurrency, progress) {
    const inputs: MatchInput[] = []

    await runBounded(rows, concurrency, async (row) => {
      let results: CatalogSearchResult[] = []
      let identified = false

      if (row.isbn) {
        results = await searchQuietly(provider, { title: row.raw_title, isbn: row.isbn })
        // `isbn:` is a Google Books qualifier. The Open Library fallback has no
        // such qualifier and reads it as text, so its hits are not identifications.
        identified = results.length > 0 && results.every((result) => result.sourceOverride == null)
        if (!identified) results = []
      }

      if (results.length === 0) {
        results = await searchQuietly(provider, { title: row.raw_title, creator: row.author })
      }

      for (const result of results) details.set(result.externalId, result)
      inputs.push({ rowId: row.id, title: row.raw_title, year: row.raw_year ?? null, results, identified })
      await progress()
    })

    return { outcomes: resolveBatch(inputs), inputs }
  },
}

// A Steam library: no year to settle anything on, but the store's exact
// published name, so a row is matched by exact title (over a few search
// variants) or not at all. Run through the year rules instead, every row would
// land in "No year in your file" with a coin-toss guess attached. An exact title
// is as good as Steam's evidence gets, so it is confident; anything else is
// `not_found` and review's search picks it up. Editions of one game merge.
const byExactTitle: MatchStrategy = {
  mergesEditions: true,
  async resolve(provider, rows, details, concurrency, progress) {
    const outcomes: MatchOutcome[] = []

    await runBounded(rows, concurrency, async (row) => {
      const chosen = await matchSteamTitle(row.raw_title, (query) => searchQuietly(provider, query))
      if (chosen) details.set(chosen.externalId, chosen)
      outcomes.push({
        rowId: row.id,
        chosen,
        verdict: chosen
          ? { state: 'confident', reason: 'exact', yearDelta: null }
          : { state: 'not_found', reason: null, yearDelta: null },
      })
      await progress()
    })

    return { outcomes, inputs: [] }
  },
}

function strategyFor(source: string): MatchStrategy {
  return source === INTERACTION_SOURCES.steam ? byExactTitle : byYear
}

// IGDB serves 4 requests a second, which the other catalogs' ceiling would
// only turn into a stream of 429s.
function concurrencyFor(mediaType: MediaType): number {
  return mediaType === 'game' ? IGDB_MAX_CONCURRENCY : CONCURRENCY
}

// `provider` is the catalog's by default; a test hands in a fake one.
export async function matchBatch(
  db: Db,
  batch: ImportBatch,
  provider: CatalogProvider = getCatalogProvider(batch.media_type as MediaType),
): Promise<void> {
  const mediaType = batch.media_type as MediaType
  const strategy = strategyFor(batch.source)

  const rows = await loadRows(db, batch.id)
  const past = await loadPastAnswers(db, batch.user_id, mediaType)

  // A row answered in an earlier import is settled the same way, without a search.
  const pending = []
  const remembered = []
  for (const row of rows) {
    if (row.state !== 'pending') continue
    const pastId = past.get(answerKey(row.raw_title, row.raw_year ?? null))
    if (pastId == null) pending.push(row)
    else remembered.push({ rowId: row.id, pastId })
  }
  await rememberRows(db, remembered)

  // Keyed by external id so the full catalog result survives resolution —
  // resolveBatch only deals in the fields that decide a match, but upserting
  // needs everything the provider returned.
  const details = new Map<string, CatalogSearchResult>()
  let matched = rows.length - pending.length

  const { outcomes, inputs } = await strategy.resolve(
    provider,
    pending,
    details,
    concurrencyFor(mediaType),
    async () => {
      matched++
      if (matched % PROGRESS_STRIDE === 0) await setMatchedCount(db, batch.id, matched)
    },
  )

  // One upsert per distinct film rather than per row: an import of a series
  // resolves hundreds of rows onto far fewer catalog entries.
  const itemIds = new Map<string, number>()
  for (const outcome of outcomes) {
    if (!outcome.chosen || itemIds.has(outcome.chosen.externalId)) continue

    const detail = details.get(outcome.chosen.externalId)
    if (!detail) continue

    const item = await upsertCatalogItem(db, mediaType, detail)
    itemIds.set(outcome.chosen.externalId, item.id)
  }

  await touchClaim(db, batch.id)

  const inputById = new Map(inputs.map((input) => [input.rowId, input]))
  const alternates = new Map<number, CandidateLike[] | null>()
  for (const outcome of outcomes) {
    const input = inputById.get(outcome.rowId)
    alternates.set(
      outcome.rowId,
      input ? inlineAlternates(input, outcome.verdict, outcome.chosen, input.results) : null,
    )
  }
  await addCreators(provider, [...alternates.values()])

  for (const outcome of outcomes) {
    const externalId = outcome.chosen?.externalId ?? null
    await recordMatch(db, outcome.rowId, {
      alternates: alternates.get(outcome.rowId) ?? null,
      state: outcome.verdict.state,
      reason: outcome.verdict.reason,
      yearDelta: outcome.verdict.yearDelta,
      externalId,
      mediaItemId: externalId == null ? null : (itemIds.get(externalId) ?? null),
    })
  }

  await setMatchedCount(db, batch.id, rows.length)
  // After every row is recorded, remembered ones included: an edition settled
  // by an earlier import's answer is still the same game as one searched now.
  if (strategy.mergesEditions) await mergeEditions(db, batch.id)
  await finishMatching(db, batch.id)
}

// Fills in who made each namesake a no-year card offers as a choice, so "1994"
// can read "1994 · Armstrong". Search results don't carry it (TMDB's search has
// no director), so each is looked up by id: only where there is a choice to make,
// once per film. A failed lookup leaves the year on its own.
export async function addCreators(
  provider: { getById(externalId: string): Promise<CatalogSearchResult | null> },
  lists: (CandidateLike[] | null)[],
): Promise<void> {
  const wanted = new Map<string, CandidateLike[]>()
  for (const list of lists) {
    if (!list || list.length < 2) continue
    for (const candidate of list) {
      if (candidate.creator) continue
      const same = wanted.get(candidate.externalId)
      if (same) same.push(candidate)
      else wanted.set(candidate.externalId, [candidate])
    }
  }

  await runBounded([...wanted.keys()], CONCURRENCY, async (externalId) => {
    const creator = await provider.getById(externalId).then(
      (detail) => detail?.creator ?? null,
      () => null,
    )
    if (creator) for (const candidate of wanted.get(externalId)!) candidate.creator = creator
  })
}
