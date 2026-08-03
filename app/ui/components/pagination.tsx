import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

export interface PaginationProps {
  page: number
  totalPages: number
  pageHref: (page: number) => string
  // Chronological by default; search results are relevance-ordered, where
  // "Newer/Older" would be a lie.
  prevLabel?: string
  nextLabel?: string
}

// Caller is expected to only render this when totalPages > 1.
export function Pagination(handle: Handle<PaginationProps>) {
  return () => {
    const { page, totalPages, pageHref, prevLabel = '← Newer', nextLabel = 'Older →' } = handle.props

    return (
      <div mix={css({ display: 'flex', justifyContent: 'space-between', marginTop: '24px' })}>
        {page > 1 ? <a href={pageHref(page - 1)}>{prevLabel}</a> : <span />}
        <span mix={css({ color: '#888', fontSize: '13px' })}>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? <a href={pageHref(page + 1)}>{nextLabel}</a> : <span />}
      </div>
    )
  }
}
