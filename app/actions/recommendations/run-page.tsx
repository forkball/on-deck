import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { GenerationParams, RecommendationRunDetail } from '../../data/recommendations/runs.ts'
import { FILTER_LABELS, joinWithAnd } from '../../data/recommendations/generate.ts'
import type { MediaType } from '../../data/mediaItems.ts'
import { Toast } from '../../ui/components/toast.tsx'
import { routes } from '../../routes.ts'
import { seenByLabel } from '../../ui/shared/seen-by.ts'
import { Page } from '../../ui/components/page.tsx'
import { MediaItemCard } from '../../ui/components/media-item-card.tsx'
import { decadeComesFromPick, genreMissNeedsLookup } from '../../data/recommendations/matching.ts'
import { ModelProvided } from './model-provided.tsx'
import { UnconfirmedPickList } from './unconfirmed-pick.tsx'
import { getCatalogProvider } from '../../data/catalog/provider.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI, mediaTypeUiFor, parseMediaType } from '../../mediaTypes.ts'
import { backLinkFrom, withReturnTo } from '../../ui/backLink.ts'

const SOURCE_LABELS: Record<MediaType, string> = {
  movie: 'Movie taste',
  tv: 'TV taste',
  book: 'Book taste',
  game: 'Game taste',
}

const PLAYER_TYPE_LABELS: Record<string, string> = {
  singleplayer: 'Singleplayer',
  multiplayer: 'Multiplayer',
}
const MULTIPLAYER_TYPE_LABELS: Record<string, string> = { coop: 'Co-op', versus: 'Versus' }
const SERIES_TYPE_LABELS: Record<string, string> = { series: 'Part of a series', standalone: 'Standalone' }

// A line of the run's summary. `modelNote` is set when the lever was applied from
// the model's own answer rather than checked against the catalog, which is true of
// exactly two of them and only for books.
export interface ParamLine {
  text: string
  modelNote?: string
}

const BOOK_GENRE_NOTE =
  "Checked against Google Books' categories wherever it has them. It has none at all for " +
  "many older works, and those were kept on the model's word rather than thrown away."

const BOOK_YEAR_NOTE =
  'Applied from the year the model gave for each book. Google Books dates editions, ' +
  'not works — its record for Dune says 2005 — so there is no catalogue year to check this against.'

const SERIES_NOTE =
  "Applied from the model's own answer for each pick. No catalogue the app reads records " +
  'whether a work belongs to a series.'

export function describeParams(params: GenerationParams, mediaType: MediaType): ParamLine[] {
  const lines: ParamLine[] = [
    { text: `Based on: ${params.sourceTypes.map((type) => SOURCE_LABELS[type]).join(', ')}` },
  ]
  if (params.genre) {
    lines.push({
      text: `Genre: ${params.genre.replace(/^./, (c) => c.toUpperCase())}`,
      modelNote: genreMissNeedsLookup(mediaType) ? BOOK_GENRE_NOTE : undefined,
    })
  }
  if (params.decade != null) {
    const label =
      params.decadeRelation === 'before'
        ? `Before ${params.decade}`
        : params.decadeRelation === 'after'
          ? `After ${params.decade + 9}`
          : `${params.decade}s`
    // Asked, not restated: the note claims what the filter did, so it reads the
    // same predicate the filter read.
    lines.push({
      text: `Decade: ${label}`,
      modelNote: decadeComesFromPick(mediaType) ? BOOK_YEAR_NOTE : undefined,
    })
  }
  if (params.length) {
    const label = getCatalogProvider(mediaType).lengthOptions.find(
      (option) => option.value === params.length,
    )?.label
    if (label) lines.push({ text: `Length: ${label}` })
  }
  if (params.playerType) {
    lines.push({ text: `Player type: ${PLAYER_TYPE_LABELS[params.playerType] ?? params.playerType}` })
  }
  if (params.multiplayerType) {
    lines.push({
      text: `Multiplayer type: ${MULTIPLAYER_TYPE_LABELS[params.multiplayerType] ?? params.multiplayerType}`,
    })
  }
  if (params.platform) lines.push({ text: `Platform: ${params.platform}` })
  if (params.series) {
    lines.push({
      text: `Series: ${SERIES_TYPE_LABELS[params.series] ?? params.series}`,
      modelNote: SERIES_NOTE,
    })
  }
  // Only ever 'no_one' or 'any' — see ui/shared/seen-by.ts.
  if (params.seenBy) lines.push({ text: `Group history: ${seenByLabel(params.seenBy)}` })
  return lines
}

// The levers only a catalog record can answer. An unmatched pick answers decade
// and series itself, and generate.ts applied those to it.
const CATALOG_LEVERS = new Set(['genre', 'length', 'playerType', 'multiplayerType', 'platform'])

function uncheckedLevers(params: GenerationParams): string[] {
  return FILTER_LABELS.filter(
    ([key]) => CATALOG_LEVERS.has(key) && params[key as keyof GenerationParams] != null,
  ).map(([, label]) => label)
}

// The model's picks no catalog entry was found for, below the ones that were.
function UnmatchedSection(handle: Handle<{ run: RecommendationRunDetail }>) {
  return () => {
    const { run } = handle.props
    const picks = run.unmatched
    const alone = run.results.length === 0
    const one = picks.length === 1
    const ui = mediaTypeUiFor(run.mediaType)
    const levers = uncheckedLevers(run.params)

    return (
      <section mix={css({ marginTop: alone ? '24px' : '40px' })}>
        <h2>
          {alone ? 'Suggested' : 'Also suggested'}, but not found in {ui.catalogName}
        </h2>
        <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: 'var(--muted)' })}>
          The model picked {one ? 'this' : 'these'}, but {ui.catalogName} has no entry we could match, so
          nothing has checked that {one ? 'it exists' : 'they exist'} or that the details are right.{' '}
          {one ? 'It' : 'They'} can't be logged from here.
          {levers.length > 0 &&
            ` Your ${joinWithAnd(levers)} ${levers.length === 1 ? 'filter' : 'filters'} couldn't be checked for ${one ? 'it' : 'them'} either.`}
        </p>
        <UnconfirmedPickList picks={picks} mediaType={run.mediaType} />
      </section>
    )
  }
}

export interface RecommendationRunPageProps {
  run: RecommendationRunDetail
  displayName: string
  prunedOldestRun?: boolean
  // Where this run was opened from, if it was opened from a list rather than
  // reached directly. Same contract as the media detail page's.
  from?: string
}

export function RecommendationRunPage(handle: Handle<RecommendationRunPageProps>) {
  return () => {
    const { run, displayName, prunedOldestRun, from } = handle.props
    const date = new Date(run.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const forLabel = ['you', ...run.otherMemberLabels].join(', ')
    const paramLines = describeParams(run.params, run.mediaType)
    const backLink = backLinkFrom(from)

    return (
      <Page
        heading={run.name || `Recommendations for ${forLabel}`}
        back={backLink}
        width="wide"
        displayName={displayName}
      >
        {prunedOldestRun && (
          <Toast message="You can keep up to 3 recommendation runs at a time, so your oldest one was removed." />
        )}
        <p mix={css({ color: 'var(--soft)' })}>
          {date}
          {run.name && ` — Recommendations for ${forLabel}`}
        </p>
        <p mix={css({ color: 'var(--muted)', fontSize: '13px' })}>
          {paramLines.map((line, index) => (
            <span key={line.text}>
              {index > 0 && ' · '}
              {line.modelNote ? <ModelProvided note={line.modelNote}>{line.text}</ModelProvided> : line.text}
            </span>
          ))}
        </p>

        {run.results.length > 0 && (
          <ul
            mix={css({
              listStyle: 'none',
              margin: '24px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            })}
          >
            {run.results.map(({ item, reason, interaction }) => {
              const itemType = parseMediaType(item.type) ?? DEFAULT_MEDIA_TYPE
              // Where a log submitted from this row comes back to, and what
              // the detail link offers as a way back.
              const runHref = routes.recommendations.show.href({ runId: String(run.id) })
              return (
                <MediaItemCard
                  key={item.id}
                  item={item}
                  mediaType={itemType}
                  interaction={interaction}
                  detailHref={withReturnTo(MEDIA_TYPE_UI[itemType].hrefs.show(item.id), runHref)}
                  returnTo={runHref}
                >
                  <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: 'var(--soft)' })}>
                    <ModelProvided note="Written by the model from the taste profile this run was built on — not a description from the catalogue.">
                      {reason}
                    </ModelProvided>
                  </p>
                </MediaItemCard>
              )
            })}
          </ul>
        )}

        {run.unmatched.length > 0 && <UnmatchedSection run={run} />}
      </Page>
    )
  }
}
