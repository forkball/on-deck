import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'
import { Link } from '../shared/form-controls.tsx'

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
        {page > 1 ? <Link href={pageHref(page - 1)}>{prevLabel}</Link> : <span />}
        <span mix={css({ color: 'var(--muted)', fontSize: '13px' })}>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? <Link href={pageHref(page + 1)}>{nextLabel}</Link> : <span />}
      </div>
    )
  }
}
