import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { getUserInteractionForItem } from '../../data/mediaItems.ts'
import type { MediaItem } from '../../data/schema.ts'
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

// A result, with the single issues it collects when it has any: a volume's
// (arrangeBookResults), or a series' own (data/catalog/series.ts).
export interface SearchResult {
  result: MediaItem
  issues?: MediaItem[]
}

export interface MediaSearchPageProps {
  mediaType: ActiveMediaType
  // The viewer's order for the media-type tabs (parseMediaOrder).
  mediaOrder: ActiveMediaType[]
  query: string
  results: SearchResult[]
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

// A plain list of cards, one under another.
function stack(gap: string) {
  return css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap })
}

// What every card on the page needs to know besides its own item.
interface ResultContext {
  mediaType: ActiveMediaType
  interactionsByItemId: MediaSearchPageProps['interactionsByItemId']
  // Where a log submitted from a card comes back to.
  returnTo: string
}

// Shared by every media type's search route. Everything that varies comes from
// MEDIA_TYPE_UI.
export function MediaSearchPage(handle: Handle<MediaSearchPageProps>) {
  return () => {
    const {
      mediaType,
      mediaOrder,
      query,
      results,
      initialVisible,
      interactionsByItemId,
      message,
      displayName,
    } = handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const ctx: ResultContext = {
      mediaType,
      interactionsByItemId,
      returnTo: `${ui.hrefs.search()}?q=${encodeURIComponent(query)}`,
    }

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

        {results.length > 0 && (
          <section>
            <h2>
              Results{' '}
              <span mix={css({ fontSize: '14px', fontWeight: 400, color: 'var(--muted)' })}>
                ({results.length})
              </span>
            </h2>
            <ul id="search-results" mix={stack('16px')}>
              {results.map(({ result, issues }) => (
                <ResultCard key={result.id} item={result} issues={issues} ctx={ctx} />
              ))}
            </ul>
            <LazyList listId="search-results" initial={initialVisible} step={initialVisible} />
          </section>
        )}
      </Page>
    )
  }
}

// A result, with the single issues it collects listed under it when it has any.
function ResultCard(handle: Handle<{ item: MediaItem; issues?: MediaItem[]; ctx: ResultContext }>) {
  return () => {
    const { item, issues, ctx } = handle.props
    const { overview } = parseMediaMetadata(item.metadata)
    return (
      <MediaItemCard
        item={item}
        mediaType={ctx.mediaType}
        interaction={ctx.interactionsByItemId.get(item.id)}
        returnTo={ctx.returnTo}
        lazyImage
        footer={issues && <IssueList issues={issues} ctx={ctx} />}
      >
        {overview && (
          <p mix={css({ fontSize: '13px', color: 'var(--soft)', margin: '8px 0 0', lineHeight: 1.4 })}>
            {summarize(overview)}
          </p>
        )}
      </MediaItemCard>
    )
  }
}

// "3 single issues · 1 logged". The count of logged ones is there because the list
// starts closed, and would otherwise hide the viewer's own status.
function issuesLabel(issues: MediaItem[], ctx: ResultContext) {
  const logged = issues.filter((issue) => ctx.interactionsByItemId.has(issue.id)).length
  const count = issues.length === 1 ? '1 single issue' : `${issues.length} single issues`
  return logged > 0 ? `${count} · ${logged} logged` : count
}

// The issues themselves, closed until asked for, under the same label whether
// they hang off a collected edition or stand as their own entry. Each is the
// ordinary card, log control and all. .issue-list in app.css sets the toggle
// apart from the card's own copy, where Doodle's unlayered summary rules would
// beat a css() one.
function IssueList(handle: Handle<{ issues: MediaItem[]; ctx: ResultContext }>) {
  return () => {
    const { issues, ctx } = handle.props
    return (
      <div class="issue-list">
        <Collapsible summary={issuesLabel(issues, ctx)}>
          <ul mix={[stack('12px'), css({ marginTop: '12px' })]}>
            {issues.map((issue) => (
              <ResultCard key={issue.id} item={issue} ctx={ctx} />
            ))}
          </ul>
        </Collapsible>
      </div>
    )
  }
}
