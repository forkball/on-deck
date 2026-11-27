// A comic series as a book of its own, so a person can log one they read as it
// came out, issue by issue, when no collected edition turns up to log instead.
//
// Google Books has no series to give: it files each issue as a volume. When a
// search answers with a series' issues and nothing that binds them
// (groupSingleIssues), the search page used to show an entry for the series that
// could only be opened, never logged. This gives that entry a media_items row of
// its own, under a source no catalog owns, so it logs, shows and counts like any
// other book — and the issues still fold out under it, as they do under a volume.
//
// The row is made the way search makes every row: when the search that needs it
// runs. Its metadata comes from the issues, so it fills in further as later
// searches turn up more of them.
//
// Nothing fetches it by id — there is nowhere to fetch it from — so it is never
// enriched, has no catalog page (catalogPageFor knows no such source), and the
// scripts and matchers that filter by a provider's sourceName pass over it.

import type { Db } from '../db.ts'
import { upsertMediaItem } from '../mediaItems.ts'
import { parseMediaMetadata } from '../mediaMetadata.ts'
import { mediaItems, type MediaItem } from '../schema.ts'
import { editionTitleKey } from './editions.ts'

export const SERIES_SOURCE = 'series'

// Keyed on the series title alone, as groupSingleIssues groups by it: one
// series' issues credit whichever writer Google picked first, so a key with the
// author in it would make two rows of one series. Two different series sharing a
// name share a row too; that is the price, and the same one the grouping pays.
export function seriesExternalId(series: string): string {
  return editionTitleKey(series)
}

// `issues` in number order, as groupSingleIssues lists them: the cover is the
// first issue's that has one, which is #1's when #1 came back.
export async function upsertSeriesItem(db: Db, series: string, issues: MediaItem[]): Promise<MediaItem> {
  const externalId = seriesExternalId(series)
  const metadata = issues.map((issue) => parseMediaMetadata(issue.metadata))
  // The year a series started: the earliest issue any search has turned up, not
  // only this one, which may have come back without #1. The merge in
  // upsertMediaItem would take the new year over the stored one.
  const existing = await db.findOne(mediaItems, {
    where: { type: 'book', external_source: SERIES_SOURCE, external_id: externalId },
  })
  const years = [...metadata, ...(existing ? [parseMediaMetadata(existing.metadata)] : [])].flatMap((m) =>
    m.releaseYear ? [m.releaseYear] : [],
  )
  const creators = [...new Set(metadata.flatMap((m) => (m.creators.length ? m.creators : [m.creator ?? ''])))]
    .filter(Boolean)

  return upsertMediaItem(
    db,
    'book',
    {
      externalId,
      title: series,
      releaseYear: years.length ? Math.min(...years) : null,
      // The comic tag is what titles count a comic by, and what the search page
      // reads an issue's grouping off.
      tags: ['graphic novel'],
      posterUrl: metadata.map((m) => m.posterUrl).find(Boolean) ?? null,
      popularity: 0,
      overview: null,
      runtimeMinutes: null,
      creator: metadata.map((m) => m.creator).find(Boolean) ?? null,
      creators,
    },
    SERIES_SOURCE,
  )
}
