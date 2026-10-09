import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { getUserInteractionForItem } from '../../data/mediaItems.ts'
import type { MediaItem } from '../../data/schema.ts'
import { MediaTabLinks } from '../components/media-tab-links.tsx'
import { MEDIA_TYPE_UI, type ActiveMediaType } from '../../mediaTypes.ts'
import { LazyList } from '../../browser/lazy-list.tsx'
import { MovieSearchForm } from '../../browser/movie-search-form.tsx'
import { Toast } from '../components/toast.tsx'
import { Page } from '../components/page.tsx'
import { MediaItemCard } from '../components/media-item-card.tsx'
import { parseMediaMetadata } from '../../data/mediaMetadata.ts'

export interface MediaSearchPageProps {
  mediaType: ActiveMediaType
  query: string
  results: MediaItem[]
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
  const text = overview.replace(/\s+/g, ' ').trim()
  if (text.length <= SUMMARY_MAX) return text

  const cut = text.slice(0, SUMMARY_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > SUMMARY_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// Shared by every media type's search route. Everything that varies comes from
// MEDIA_TYPE_UI.
export function MediaSearchPage(handle: Handle<MediaSearchPageProps>) {
  return () => {
    const { mediaType, query, results, initialVisible, interactionsByItemId, message, displayName } =
      handle.props
    const ui = MEDIA_TYPE_UI[mediaType]
    const returnTo = `${ui.hrefs.search()}?q=${encodeURIComponent(query)}`

    return (
      <Page heading={ui.searchHeading} width="wide" displayName={displayName}>
        {message && <Toast message={message} />}
        <MediaTabLinks
          current={mediaType}
          // Switching type starts a fresh search rather than carrying the
          // query across: a title rarely means the same thing in two
          // catalogs, so carrying it just fills the new tab with noise.
          hrefFor={(type) => MEDIA_TYPE_UI[type].hrefs.search()}
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
              {results.map((item) => {
                const { overview } = parseMediaMetadata(item.metadata)
                return (
                  <MediaItemCard
                    key={item.id}
                    item={item}
                    mediaType={mediaType}
                    interaction={interactionsByItemId.get(item.id)}
                    returnTo={returnTo}
                    lazyImage
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
              })}
            </ul>
            <LazyList listId="search-results" initial={initialVisible} step={initialVisible} />
          </section>
        )}
      </Page>
    )
  }
}
