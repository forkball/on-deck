import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { GenerationParams, RecommendationRunDetail } from '../../data/recommendations/runs.ts'
import type { UnmatchedPick } from '../../data/recommendations/unmatched.ts'
import type { MediaType } from '../../data/mediaItems.ts'
import { Toast } from '../../ui/components/toast.tsx'
import { routes } from '../../routes.ts'
import { FrameForm } from '../../browser/frame-form.tsx'
import { NotesField } from '../../ui/components/notes-field.tsx'
import { Field } from '../../ui/shared/field.tsx'
import { seenByLabel } from '../../ui/shared/seen-by.ts'
import { Page } from '../../ui/components/page.tsx'
import { FloatingDropdown } from '../../ui/components/floating-dropdown.tsx'
import { StarRatingInput } from '../../ui/components/star-rating.tsx'
import { StatusSelect } from '../../ui/components/status-select.tsx'
import { decadeComesFromPick, genreMissNeedsLookup } from '../../data/recommendations/matching.ts'
import { ModelProvided } from './model-provided.tsx'
import { PlatformList } from '../../ui/components/platform-list.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'
import { getCatalogProvider } from '../../data/catalog/provider.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI, mediaTypeUiFor, parseMediaType } from '../../mediaTypes.ts'
import { statusBadgeColor, statusLabelsFor } from '../../interactionStatus.ts'
import { backLinkFrom, withReturnTo } from '../../ui/backLink.ts'
import { Button } from '../../ui/shared/form-controls.tsx'

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

// The levers that need a catalog record to answer, by the name the summary line
// gives them. Decade and series are absent: an unmatched pick answers those itself,
// and generate.ts applied them to it.
function uncheckedLevers(params: GenerationParams): string[] {
  const levers: string[] = []
  if (params.genre) levers.push('genre')
  if (params.length) levers.push('length')
  if (params.playerType) levers.push('player type')
  if (params.multiplayerType) levers.push('multiplayer type')
  if (params.platform) levers.push('platform')
  return levers
}

const UNMATCHED_REASON_NOTE =
  'Written by the model from the taste profile this run was built on. The catalog has no entry we could match, so nothing has checked it.'

// The model's picks no catalog entry was found for, below the ones that were.
//
// Deliberately not the recommendation card, for the reason the unconfirmed page
// gives: no cover, no log button, no detail link, because there is no catalog entry
// behind any of these and each of those controls would imply there was. What it has
// instead is a way to look for one.
function UnmatchedSection(
  handle: Handle<{ picks: UnmatchedPick[]; run: RecommendationRunDetail; alone: boolean }>,
) {
  return () => {
    const { picks, run, alone } = handle.props
    const ui = mediaTypeUiFor(run.mediaType)
    const levers = uncheckedLevers(run.params)
    const leverList =
      levers.length <= 1
        ? levers.join('')
        : `${levers.slice(0, -1).join(', ')} and ${levers[levers.length - 1]}`

    return (
      <section mix={css({ marginTop: alone ? '24px' : '40px' })}>
        <h2>
          {alone ? 'Suggested' : 'Also suggested'}, but not found in {ui.catalogName}
        </h2>
        <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: '#888' })}>
          The model picked {picks.length === 1 ? 'this' : 'these'}, but {ui.catalogName} has no entry we could
          match, so nothing has checked that {picks.length === 1 ? 'it exists' : 'they exist'} or that the
          details are right. {picks.length === 1 ? 'It' : 'They'} can't be logged from here.
          {levers.length > 0 &&
            ` Your ${leverList} ${levers.length === 1 ? 'filter' : 'filters'} couldn't be checked for ${picks.length === 1 ? 'it' : 'them'} either.`}
        </p>
        <ol
          mix={css({
            margin: 0,
            padding: '0 0 0 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          })}
        >
          {picks.map((pick) => (
            <li key={`${pick.title}-${pick.year}`}>
              <span mix={css({ fontWeight: 700 })}>{pick.title}</span>
              {pick.year ? ` (${pick.year})` : ''}
              {pick.creator && <span mix={css({ color: '#555' })}> — {pick.creator}</span>}
              <p mix={css({ margin: '4px 0 0', fontStyle: 'italic', color: '#555' })}>
                <ModelProvided note={UNMATCHED_REASON_NOTE}>{pick.reason}</ModelProvided>
              </p>
              <p mix={css({ margin: '4px 0 0', fontSize: '13px' })}>
                <a
                  href={ui.catalogSearchUrl(pick.title, pick.year)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="tap-area"
                >
                  Search {ui.catalogName}
                </a>
              </p>
            </li>
          ))}
        </ol>
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
        <p mix={css({ color: '#555' })}>
          {date}
          {run.name && ` — Recommendations for ${forLabel}`}
        </p>
        <p mix={css({ color: '#888', fontSize: '13px' })}>
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
              const { releaseYear, posterUrl, tags, platforms } = parseMediaMetadata(item.metadata)
              const itemType = parseMediaType(item.type) ?? DEFAULT_MEDIA_TYPE
              const itemUi = MEDIA_TYPE_UI[itemType]
              // Where a log submitted from this row comes back to, and what
              // the detail link offers as a way back.
              const runHref = routes.recommendations.show.href({ runId: String(run.id) })
              const detailHref = withReturnTo(itemUi.hrefs.show(item.id), runHref)

              return (
                <li
                  key={item.id}
                  mix={css({
                    display: 'flex',
                    gap: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '16px',
                  })}
                >
                  {posterUrl ? (
                    <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
                      <img
                        src={posterUrl}
                        alt={`${item.title} poster`}
                        mix={css({ width: '60px', borderRadius: '4px', display: 'block' })}
                      />
                    </a>
                  ) : (
                    <div
                      mix={css({
                        width: '60px',
                        height: '90px',
                        flex: '0 0 auto',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                      })}
                    />
                  )}
                  <div mix={css({ flex: '1 1 auto', minWidth: 0 })}>
                    <a href={detailHref} mix={css({ fontWeight: 700 })}>
                      {item.title}
                    </a>
                    {releaseYear ? ` (${releaseYear})` : ''}
                    {interaction && (
                      <div mix={css({ marginTop: '4px' })}>
                        <span
                          mix={css({
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            border: `1px solid ${statusBadgeColor(interaction.status)}`,
                            color: statusBadgeColor(interaction.status),
                          })}
                        >
                          {statusLabelsFor(itemType)[interaction.status] ?? interaction.status}
                        </span>
                      </div>
                    )}
                    {tags.length > 0 && (
                      <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' })}>
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            mix={css({
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              border: '1px solid #ccc',
                              color: '#555',
                            })}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Empty for everything but games, so no other type
                        renders a gap here. */}
                    <PlatformList platforms={platforms} />
                    <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: '#555' })}>
                      <ModelProvided note="Written by the model from the taste profile this run was built on — not a description from the catalogue.">
                        {reason}
                      </ModelProvided>
                    </p>
                  </div>
                  {/* Right-hand column, so the control lines up down the list
                      regardless of how long each title and reason runs. The
                      panel hangs from the right edge because at this position
                      a left-anchored one would open off the page. */}
                  <div mix={css({ flex: '0 0 auto', alignSelf: 'flex-start' })}>
                    <FloatingDropdown triggerLabel={interaction ? 'Edit' : 'Log'} align="right">
                      <form
                        method="post"
                        action={itemUi.hrefs.log(item.id)}
                        mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
                      >
                        <input type="hidden" name="return_to" value={runHref} />
                        <Field label={`Add to ${itemUi.singular} list`}>
                          <StatusSelect
                            mediaType={itemType}
                            name="status"
                            defaultValue={interaction?.status ?? 'want_to_consume'}
                          />
                        </Field>
                        {/* Pre-filled from the existing log: the action writes
                            whatever is submitted, so leaving these out would
                            null a rating or note already there. */}
                        <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '10px' })}>
                          <div>
                            <p mix={css({ margin: '0 0 4px' })}>Rating</p>
                            <StarRatingInput
                              name="rating"
                              idPrefix={`rec-rating-${item.id}`}
                              defaultValue={interaction?.rating ?? null}
                              disliked={interaction?.disliked ?? null}
                            />
                          </div>
                          <NotesField defaultValue={interaction?.notes} />
                        </div>
                        <Button type="submit">Save</Button>
                        <FrameForm />
                      </form>
                    </FloatingDropdown>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {run.unmatched.length > 0 && (
          <UnmatchedSection picks={run.unmatched} run={run} alone={run.results.length === 0} />
        )}
      </Page>
    )
  }
}
