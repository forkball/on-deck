import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { getUserInteractionForItem } from '../../data/mediaItems.ts'
import type { MediaItem } from '../../data/schema.ts'
import type { SearchEntry } from '../../data/catalog/editions.ts'
import { Collapsible } from '../shared/collapsible.tsx'
import { MediaTabLinks } from '../components/media-tab-links.tsx'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { routes } from '../../routes.ts'
import { LazyList } from '../../browser/lazy-list.tsx'
import { MovieSearchForm } from '../../browser/movie-search-form.tsx'
import { Toast } from '../components/toast.tsx'
import { Page } from '../components/page.tsx'
import { MediaItemCard } from '../components/media-item-card.tsx'
import { markdownToPlainText } from '../components/markdown.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'

export interface MediaSearchPageProps {
  mediaType: ActiveMediaType
  // The viewer's order for the media-type tabs (parseMediaOrder).
  mediaOrder: ActiveMediaType[]
  query: string
  // A result, or a series' single issues gathered into one (groupSingleIssues).
  entries: SearchEntry<MediaItem>[]
  // How many are visible before scrolling reveals the rest.
  initialVisible: number
  interactionsByItemId: Map<number, Awaited<ReturnType<typeof getUserInteractionForItem>>>
  message?: string
  displayName: string
}

// Two lines of blurb, give or take. Cut on the server rather than clamped in CSS
// because a description runs to several hundred words, and all of it would otherwise
// travel to the browser twenty times over to be hidden on arrival.
//
// Cut at a word, but only where that leaves most of the budget: a space at character
// 40 of 200 is not worth throwing away 160 characters to land on.
const SUMMARY_MAX = 200

function summarize(overview: string): string {
  const text = markdownToPlainText(overview).replace(/\s+/g, ' ').trim()
  if (text.length <= SUMMARY_MAX) return text

  const cut = text.slice(0, SUMMARY_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > SUMMARY_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// Shared by every media type's search route. Everything that varies comes from
// MEDIA_TYPE_UI.
export function MediaSearchPage(handle: Handle<MediaSearchPageProps>) {
  return () => {
    const {
      mediaType,
      mediaOrder,
      query,
      entries,
      initialVisible,
      interactionsByItemId,
      message,
      displayName,
    } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const returnTo = `${ui.hrefs.search()}?q=${encodeURIComponent(query)}`

    return (
      <Page heading={ui.searchHeading} width="wide" displayName={displayName}>
        {message && <Toast message={message} />}
        <MediaTabLinks
          current={mediaType}
          order={mediaOrder}
          // Switching type starts a fresh search rather than carrying the
          // query across: a title rarely means the same thing in two
          // catalogs, so carrying it just fills the new tab with noise.
          hrefFor={(type) => MEDIA_TYPE_UI[type].hrefs.search()}
          peopleHref={routes.users.search.href()}
        />
        <MovieSearchForm
          query={query}
          searchHref={ui.hrefs.search()}
          suggestHref={ui.hrefs.suggest()}
          importHref={ui.hrefs.import()}
          placeholder={ui.searchPlaceholder}
        />

        {entries.length > 0 && (
          <section>
            <h2>
              Results{' '}
              <span mix={css({ fontSize: '14px', fontWeight: 400, color: 'var(--muted)' })}>
                ({entries.length})
              </span>
            </h2>
            <ul
              id="search-results"
              mix={css({
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              })}
            >
              {entries.map((entry) =>
                entry.kind === 'single' ? (
                  <ResultCard
                    key={entry.result.id}
                    item={entry.result}
                    issues={entry.issues}
                    mediaType={mediaType}
                    interactionsByItemId={interactionsByItemId}
                    returnTo={returnTo}
                  />
                ) : (
                  <IssueGroupCard
                    key={`issues-${entry.issues[0]!.id}`}
                    series={entry.series}
                    issues={entry.issues}
                    mediaType={mediaType}
                    interactionsByItemId={interactionsByItemId}
                    returnTo={returnTo}
                  />
                ),
              )}
            </ul>
            <LazyList listId="search-results" initial={initialVisible} step={initialVisible} />
          </section>
        )}
      </Page>
    )
  }
}

interface ResultCardProps {
  item: MediaItem
  // The single issues this edition collects, listed under it.
  issues?: MediaItem[]
  mediaType: ActiveMediaType
  interactionsByItemId: MediaSearchPageProps['interactionsByItemId']
  returnTo: string
}

function ResultCard(handle: Handle<ResultCardProps>) {
  return () => {
    const { item, issues, mediaType, interactionsByItemId, returnTo } = handle.props
    const { overview } = parseMediaMetadata(item.metadata)
    return (
      <MediaItemCard
        item={item}
        mediaType={mediaType}
        interaction={interactionsByItemId.get(item.id)}
        returnTo={returnTo}
        lazyImage
        footer={
          issues && (
            <IssueList
              issues={issues}
              mediaType={mediaType}
              interactionsByItemId={interactionsByItemId}
              returnTo={returnTo}
            />
          )
        }
      >
        {overview && (
          <p
            mix={css({
              fontSize: '13px',
              color: 'var(--soft)',
              margin: '8px 0 0',
              lineHeight: 1.4,
            })}
          >
            {summarize(overview)}
          </p>
        )}
      </MediaItemCard>
    )
  }
}

// A series' single issues as one row that opens to list them, so a search for
// the series isn't five near-identical cards ahead of the collected book. Each
// issue inside is the ordinary card, log control and all. Says how many are
// logged, since closed it would otherwise hide the viewer's own status.
function IssueGroupCard(
  handle: Handle<Omit<ResultCardProps, 'item'> & { series: string; issues: MediaItem[] }>,
) {
  return () => {
    const { series, issues, mediaType, interactionsByItemId, returnTo } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const cover = issues.map((issue) => parseMediaMetadata(issue.metadata).posterUrl).find(Boolean)

    return (
      <li
        mix={css({
          border: '1px solid var(--rule)',
          borderLeft: `4px solid ${ui.hue}`,
          borderRadius: '8px',
          padding: '16px',
        })}
      >
        <div mix={css({ display: 'flex', gap: '12px' })}>
          {cover ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              mix={css({
                width: '60px',
                borderRadius: '4px',
                display: 'block',
                flex: '0 0 auto',
                alignSelf: 'flex-start',
              })}
            />
          ) : (
            <div
              mix={css({
                width: '60px',
                height: '90px',
                flex: '0 0 auto',
                border: '1px solid var(--rule)',
                borderRadius: '4px',
              })}
            />
          )}
          <div mix={css({ flex: '1 1 0', minWidth: 0 })}>
            <div>{series}</div>
          </div>
        </div>
        <IssueList
          issues={issues}
          mediaType={mediaType}
          interactionsByItemId={interactionsByItemId}
          returnTo={returnTo}
        />
      </li>
    )
  }
}

// "3 single issues · 1 logged". The count of logged ones is there because the list
// starts closed, and would otherwise hide the viewer's own status.
function issuesLabel(
  issues: MediaItem[],
  interactionsByItemId: MediaSearchPageProps['interactionsByItemId'],
) {
  const logged = issues.filter((issue) => interactionsByItemId.has(issue.id)).length
  const count = issues.length === 1 ? '1 single issue' : `${issues.length} single issues`
  return logged > 0 ? `${count} · ${logged} logged` : count
}

// The issues themselves, closed until asked for, under the same label whether
// they hang off a collected edition or stand as their own entry. Each is the
// ordinary card, log control and all.
function IssueList(handle: Handle<Omit<ResultCardProps, 'item' | 'issues'> & { issues: MediaItem[] }>) {
  return () => {
    const { issues, mediaType, interactionsByItemId, returnTo } = handle.props
    return (
      // .issue-list in app.css: a toggle set apart from the card's own copy,
      // where Doodle's unlayered summary rules would beat a css() one.
      <div class="issue-list">
        <Collapsible summary={issuesLabel(issues, interactionsByItemId)}>
          <ul
            mix={css({
              listStyle: 'none',
              margin: '12px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            })}
          >
            {issues.map((issue) => (
              <ResultCard
                key={issue.id}
                item={issue}
                mediaType={mediaType}
                interactionsByItemId={interactionsByItemId}
                returnTo={returnTo}
              />
            ))}
          </ul>
        </Collapsible>
      </div>
    )
  }
}
